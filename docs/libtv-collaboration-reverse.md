# LibTV 多人协作方案逆向（节点状态 / 锁定 / 共享边界）

> 来源：画布页 Network 抓包 + 前端 chunk 逆向 + i18n（非官方文档）。  
> 样本：`/canvas?spaceId=...&projectId=...`；抓包时间 2026-07-16。  
> **相对初版修正**：协作实时通道**有 WebSocket**（`wss://im.../ws/collaboration`）；HTTP 轮询是快照/降级，不是唯一通道。

---

## 1. 总体架构

```text
结构落库     → api.liblib.tv   POST /api/canvas/nodes/batch
实时协作     → im.liblib.tv    WSS  /ws/collaboration?token&project_id
快照/降级    → im.liblib.tv    GET  /collaboration/{members,locks,session}  (~1s / 降级时)
会话心跳     → api.liblib.tv   POST /api/canvas/project/heartbeat
个人视口持久 → api.liblib.tv   POST /api/canvas/project/user-state/update
               + draft/update（beforeunload 可 sendBeacon）
```

| 通道 | 用途 |
|------|------|
| **WS** `wss://{imHost}/ws/collaboration` | lock / unlock / cursor / camera / presence / `update_node_state` |
| **HTTP GET** members / locks / session | 进房快照、对账、WS 降级时轮询 |
| **HTTP POST** nodes/batch | 节点+连线增量权威落库 |
| **HTTP POST** heartbeat | 多 Tab 会话互斥 |
| **HTTP POST** user-state / draft | 本端视口等个人态持久化 |

鉴权：请求头 `token`（cookie `usertoken`）；WS 也可走 subprotocol `liblibtv-token-{token}`。

---

## 2. 已确认 API 响应形状

### 2.1 Members

`GET im.liblib.tv/api/v1/project/collaboration/members?projectId={uuid}`

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "userId": "007d9225c59f49dcbb51b109bbb14e31",
      "authUserId": 9936679,
      "nickname": "182****7535",
      "avatar": "https://...",
      "joinedAt": 1784201755207
    }
  ]
}
```

### 2.2 Locks（HTTP 快照；空数组时结构由 chunk 解析器确认）

`GET .../collaboration/locks?projectId={uuid}`

```json
{ "code": 0, "message": "success", "data": [ /* LockRow[] */ ] }
```

**LockRow（前端校验字段）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodeId` | string | 被锁节点 id（即 `nodeKey`） |
| `userId` | string | 持锁用户 |
| `nickname` | string | 展示名 |
| `avatar` | string | 头像 |
| `lockedAt` | number | 加锁时间戳 |

前端再补 `observedAt`（本地观测时间）。

### 2.3 Session

`GET .../collaboration/session?projectId={uuid}`

```json
{
  "code": 0,
  "data": {
    "sessionId": "c6fb8684-30e4-480c-aab8-04bd7a23d0fc",
    "projectId": "77c8cf6f5e5c48d2aefe734ea2263215",
    "members": [ /* 同 members 字段，可含历史协作成员 */ ],
    "createdAt": 1782368887341,
    "updatedAt": 1784201755212
  }
}
```

另有 `GET .../project/session/list?projectId={spaceId}`（空间维度会话列表）。

### 2.4 节点文档上的并发元数据（detail）

`nodeList[].data`（JSON 字符串）内常见：

```json
"_meta": {
  "rev": 1782897195000,
  "schemaVersion": 1,
  "lastWriter": "84f70a073773489cbde120c58c64ed27",
  "lastWriteTs": 1783070432660
}
```

→ 节点级 revision / lastWriter，配合 batch 增量与冲突重试。

---

## 3. WebSocket 消息（重点）

**连接：** `wss://{imHost}/ws/collaboration?token=...&project_id=...`  
默认 path：`/ws/collaboration`（可配 `collabWsPath`）。

### 出站（客户端 → 服务端）

| type | 作用 |
|------|------|
| `lock_node` | `{ nodeId }` 申请编辑锁 |
| `unlock_node` | `{ nodeId }` 释放锁 |
| `update_node_state` | 短暂态 / lease 相关 op 信封 |
| `canvas_presence` | 如 `{ patch: { followingUserId } }` |
| `setFollow` / `clearFollow` | 跟随控制 |
| cursor / camera 调度 | `scheduleCursorSend` / `scheduleCameraSend` |

### 入站（服务端 → 客户端，chunk 中出现的 type）

| type | 作用 |
|------|------|
| `lock_result` | 加锁结果 |
| `node_locked` / `node_unlocked` | 锁变更广播 |
| `node_state_updated` / `node_state_update_rejected` | 节点态同步 / 拒绝 |
| `cursor_move` | 远端光标 |
| `camera_move` | 远端镜头（跟随用）：`x,y,zoom,viewport{w,h}` |
| `follow_resolved` / `follow_rejected` / `follow_terminated` / `follow_count_changed` | 跟随链 |
| `socket_opened` 等 | 连接 FSM |

**降级：** `collabHttpPollWhenDegradedMs` > 0 时，WS 不稳改走 HTTP 轮询。

---

## 4. 锁定模型（选中即锁 + 编辑租约）

### 4.1 触发：选中即申请锁

不是「只有打开编辑器才锁」，而是：

1. 选中节点 → `requestEditLock(nodeId)`  
2. WS 发 `lock_node`  
3. 进入 `pending` → 等到 `myLockedNodeIds` 含该 id → **`acquired`**  
4. 若 `nodeLocks[id]` 已被他人占用 → **`denied`**（UI：`collabNodeEditingBy`）  
5. 无 bridge / 超时 / abort → **`no_api` / `timeout` / `aborted`**

`useCollabSelectionPhase`：仅 `acquired` 或 `no_api` 时允许继续交互；`denied` 时取消选中。

### 4.2 持锁原因（reconcile 不会释放）

锁会被 **keep** 若任一成立：

- 仍在 `selectedNodeIds`
- 在 `acquiredBySelection`
- `externalRefs` 引用计数 > 0（外部面板/工具借锁）
- `taskLoadingNodeIds`（本人任务加载中）
- editLock **refcount > 1**

否则释放，原因：`refcount_zero` / `orphan_idle`。

### 4.3 时间与上限（chunk 常量）

| 项 | 值 | 说明 |
|----|-----|------|
| 选区同步 debounce | **250ms** | 选中变化批量申请锁 |
| 同时选区持锁上限 | **50** | 超出不再为新选中申请 |
| 外部借锁 timeout | **5s** | `acquireExternalSelectionLock` |
| 空闲强制释放 | **默认 300s（5min）** | 无指针/键盘活动后 `releaseEditLock` |
| reconcile 周期 | **15s** | `setInterval(..., 15e3)` |
| reconcile 触发优先级 | ws_reconnect > visibility > selection > myLock > interval | |

beforeunload：对仍持锁节点发 `unlock_node`。

### 4.4 锁拦住什么

| 操作 | 远端持锁 |
|------|----------|
| 选中 / 编辑 | ❌ denied |
| 复制节点 / 图片 | ❌ i18n |
| 连线源/目标 | ❌（`nJ`/`nQ`） |
| 查看 | ✅ |
| 他人任务占用节点 | ❌ `task-owned-by-other` |

另有 `bypassEditLock`：权威 resync / 部分同步路径可绕过。

### 4.5 多 Tab

- `canvasHeartbeat({ projectUuid, sessionId, timestamp })`
- sessionStorage：`canvas-session-id` / `__libtv_collab_tab_id__` / `libtv-tab-instance-id`
- 过期 →「协作会话已过期 / 已在其他标签页打开」+ 暂停 syncQueue

---

## 5. 节点状态（协作视角）

| 状态 | 含义 |
|------|------|
| 空闲 | 无 `nodeLocks[id]` |
| pending 加锁 | 已发 `lock_node`，等确认 |
| 本人持锁 | 在 `myLockedNodeIds` |
| 远端锁定 | `nodeLocks[id].userId !== me` |
| 任务被他人占用 | `taskInfo.ownerUserId` 他人 |
| 被删 / 被更新 / 版本过旧 | v4Abort* i18n → reload / 刷新 |
| 只读框 | `data-collab-readonly-frame` |

画布门控（`canvasLocked` / 标注等）是**本端交互层**，与 IM 节点锁不同层。

---

## 6. 共享 vs 不共享

### ✅ 共享

| 内容 | 通道 |
|------|------|
| 节点 / 连线结构与 data | `nodes/batch` + 可选 WS `update_node_state` / 权威 resync |
| 生成结果写回节点 | batch（可协作广播） |
| 节点编辑锁 | WS `lock_node` + HTTP locks 快照 |
| 在线成员 | WS presence + HTTP members |
| 远端光标 | WS `cursor_move` |
| 跟随中的镜头 | WS `camera_move`（仅 Follow） |
| lastWriter / rev | 节点 `_meta` |

### ❌ 默认不共享

| 内容 | 说明 |
|------|------|
| **个人视口** | 各人独立；持久化走 `user-state` / `draft` 的 viewportX/Y/Zoom，**不是**实时广播给所有人 |
| 本端 UI 模式 | 标注 / 截图 / 拾取等 |
| 未获锁的输入草稿 | 以锁 + 落库后为准 |

### ⚪ 可选共享

| 内容 | 说明 |
|------|------|
| 视口跟随 | 显式 Follow → `camera_move` + `followingUserId` |
| 光标 | 有 `cursor_move`，属 presence，不进文档 |

**口诀：**

```text
文档结构 → batch 共享
锁 / 成员 / 光标 → WS 共享
视口 → 默认私有；Follow 才共享镜头
```

---

## 7. 同步 UX（CollabPortal）

已同步 / 待同步 / 同步中 / 冲突重试 / 失败重试 / 已离线 / 降级。  
产品文案：**协作画布实时增量同步，无需手动全量保存。**  
冲突策略偏 **重试 / 版本过旧刷新**，不是 CRDT merge。

---

## 8. 与 AImanju

| 维度 | LibTV | AImanju |
|------|-------|---------|
| 实时 | **WS** `/ws/collaboration` + HTTP 降级 | WS `canvas:op` / BroadcastChannel |
| 锁 | 服务端锁 + **选中即 `lock_node`** | dev `selectionLease`（本地租约） |
| 锁快照 | GET `/locks` 对账 | 无独立 locks API |
| 视口 | 默认不广播；可 Follow | viewport **不**入 op（方向一致） |
| 落库 | `/canvas/nodes/batch` | `/node/batch` + `expected_version` |

---

## 9. 仍待钉死（可选深挖）

1. `lock_result` / `node_locked` 完整 JSON 样例（需双人同时编辑抓 WS 帧）  
2. `update_node_state` 的 state 信封字段与 batch 的分工边界  
3. `collabHttpPollWhenDegradedMs` 线上配置值  

建议：登录态双人同项目 → Network 过滤 `ws/collaboration` + `nodes/batch` + `locks`。

---

## 相关

- [libtv-node-connection-rules.md](./libtv-node-connection-rules.md) — 协作锁挡连线  
- [generation-progress-polling-aimaju-vs-libtv.md](./generation-progress-polling-aimaju-vs-libtv.md) — 生成写回可广播  
