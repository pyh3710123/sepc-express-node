# 画布生成任务 Progress 轮询：AImanju vs LibTV vs TapNow

本文对照三方架构：

1. **本项目（AImanju）** 文本节点现有轮询  
2. **LibTV** 线上画布 Progress Poller（逆向）  
3. **TapNow** 线上画布创建任务 + TaskPollingProvider（逆向）

整理区别、优缺点、全面铺开风险，以及推荐演进方向。

> LibTV 逆向：前端 bundle（`/api/task/generation/progress`、全局 Poller）。  
> TapNow 逆向：`vendor-pkg-canvas` / `vendor-packages`（`api/conversation/v1/generations/*`、`TaskPollingProvider`）。  
> 本项目依据：`useTextNodeGeneration` + `generationTaskProgressBatcher`。

---

## 1. 三方架构总表

| 维度 | 本项目（现状） | LibTV | TapNow |
|------|----------------|-------|--------|
| 驱动方式 | **每节点**各自 `setTimeout` | **画布级**全局 Poller（扫节点 `taskInfo.loading`） | **应用级** `TaskPollingProvider`（扫内存任务 Map） |
| 任务登记 | 节点内状态 | 节点 `taskInfo` | Zustand `tasks: Map` + 节点 `taskInfo` |
| 多任务合并 | 32ms 短窗碰巧合并 | 每拍主动收集全部 loading `taskId` | 每拍 `getPendingTasks()` 全部 id |
| 创建接口 | 统一 `POST /task/generation/create` | 统一 `POST /api/task/generation/create` | **按媒体分接口**：`/generations/text\|image\|video\|audio`（另有 v2 world） |
| 创建返回 | `task_id` 等 | `taskId` 等 | `data.result.ids[]`（取第一个登记） |
| 进度接口 | `POST .../progress`，`{ task_ids }` | `POST .../progress`，`{ taskIds, teamId? }` | **`GET .../generations/tasks?ids=...&_t=`** |
| 响应形态 | 兼容数组 / 归一化 snapshot | `data.progresses[]` | `data[]` 按任务项（含 `status` / `not_found` / `final_task_id`） |
| 状态枚举 | pending / completed / failed（字符串归一化） | `0/1` 进行中，`2` 成功，`3` 失败 | `"pending"` / `"completed"` / `"failed"` |
| 轮询间隔 | 固定 ~**2s** | **2s** 起，无变化退避至 **30s** | 默认 **5s**；托管配置可到 **7.5s**（×1.5） |
| 退避 | 无 | 有（指数，封顶 30s） | **无进度退避**；失败计数后**暂停该任务轮询** |
| 失败熔断 | 单任务超时 / 最大次数 | 连续失败 ≥10 → 批量标失败清队 | 连续失败 ≥**3** → `pollingPaused`，提示点「重试」 |
| 刷新恢复 | `taskInfo` + localStorage + resume | mount `POST /progress/batch` | `POST .../tasks/recoverable`（按 `nodeids`+`types`）；create 失败后可延迟 5s 再 recover |
| 完成反馈 | 写回节点 | 写回节点（可协作广播） | 写回节点 + 可选 **桌面 Notification**（页不可见时） |
| 覆盖范围 | 当前主要文本 | 全类型 `taskInfo` | image / video / text / audio / 3d |

### 1.1 本项目路径（示意）

```text
节点 A timer ──┐
节点 B timer ──┼──► 32ms batch 窗口 ──► POST progress { task_ids: [...] }
节点 C timer ──┘         （对齐则合一批；错开则多批）
```

### 1.2 LibTV 路径（示意）

```text
create → 写入各节点 taskInfo.loading + taskId
                │
                ▼
        画布全局 Poller（读 store.nodes）
                │
                ├─ 筛 loading && taskId
                └─ POST progress { taskIds: ey }
                          │
                          ▼
                 按 taskId 分发写回各节点
                 （无变化则 2s→4s→…→30s）
```

### 1.3 TapNow 路径（示意）

```text
POST /generations/{text|image|video|audio}
        → data.result.ids[0]
                │
                ├─ addTask(id, { onComplete, onError })   // 全局 Map
                └─ 节点 taskInfo = { status: pending, taskId }
                │
                ▼
        TaskPollingProvider（全局挂一次）
                │
                ├─ getPendingTasks()
                └─ GET /generations/tasks?ids=id1,id2,...&_t=
                          │
                          ▼
                 completed → onComplete + 可选 Notification
                 failed    → onError
                 连续 poll 失败 ≥3 → 暂停该任务，等用户 Retry
```

---

## 2. TapNow 逆向要点

### 2.1 创建任务

| 项 | 值 |
|----|-----|
| Base | `api/conversation/v1/generations` |
| 文本 | `POST .../text` |
| 图片 | `POST .../image` |
| 视频 | `POST .../video` |
| 音频 | `POST .../audio` |
| World | `POST api/conversation/v2/generations` |
| 成功标识 | `data.result.ids`（数组） |
| 入队 | `useGenerationBase.send` → `addTask(ids[0], callbacks)` |

画布侧通过统一的 `createTaskCallbacks`（`onTaskComplete` / `onTaskError`）把结果注入节点（`injectType` 如 `src`），并设置 `taskInfo.status = "pending"`。

### 2.2 轮询

| 项 | 值 |
|----|-----|
| Provider | `TaskPollingProvider`（组件挂载即启动） |
| 存储 | Zustand：`tasks: Map<taskId, { status, onComplete, onError, pollFailCount }>` |
| 接口 | `GET api/conversation/v1/generations/tasks` |
| 参数 | `ids`（全部 pending）、`_t`（防缓存时间戳） |
| 默认间隔 | `5000ms` |
| 托管间隔 | `generation.task-provider`：fallback `5s`，managed `7.5s`，multiplier `1.5` |
| 成功项 | `status==="completed"` → 回调 + `removeTask`；重置 `pollFailCount` |
| 失败项 | `status==="failed"` → `failed_reason(_detail)` → onError |
| 特殊 | `not_found`；`final_task_id` 替换任务 id（`replaceTask`） |
| 连续失败 | `pollFailCount >= 3` → 暂停轮询，文案「任务状态查询失败，点击重试」 |

### 2.3 恢复

| 项 | 值 |
|----|-----|
| 按节点追任务 | `POST .../v1/generations/tasks/recoverable`（`getLatestTasksByNodes`，body 含 `nodeids` + `types`） |
| 初始化 | `initialize`：pending 节点重新 `addTask`；可恢复失败态用 recoverable |
| create 失败后 | 延迟 `generationFailureRecoveryDelayMs = 5000` 再 `recoverLatestTaskForNode` |

---

## 3. LibTV vs TapNow：区别与优缺点

### 3.1 相同点（都比「每节点各自 timer」强）

- **全局 / 统一 Poller**，多节点同拍合并为 **1 次**状态查询。  
- 节点只关心 create + 写回；轮询生命周期中心化。  
- 有刷新 / 丢结果恢复通道。  
- 有连续失败熔断，避免无限打接口。

### 3.2 关键差异

| 点 | LibTV | TapNow |
|----|-------|--------|
| 任务源 of truth | **节点文档** `taskInfo.loading` | **客户端 Map** + 节点 `pending` 双写 |
| 进度协议 | POST batch progress，偏「进度快照」 | GET batch tasks，偏「任务状态机」 |
| Create | 统一 create + 丰富 `params` | 按媒体拆 endpoint，元数据 `metadata.node_id` |
| 间隔策略 | **有进展就快、无进展就慢**（体验与省流均衡） | **固定 ~5s**（实现简单，长任务更省，短任务稍钝） |
| 失败 UX | 多次失败直接标失败 | 少次失败就 **暂停等用户 Retry**（更可控） |
| 协作 / 团队 | `teamId`、progress 广播等更重 | 侧重个人画布 + Notification |
| 复杂度 | 高（退避、协作、类型全覆盖） | 中（Provider + Map + recoverable） |

### 3.3 LibTV 相对 TapNow

**优点**

1. 无变化退避到 30s，卡住任务更省流。  
2. 以节点 `loading` 为准，刷新后只要文档在就能续，不一定依赖内存 Map。  
3. 进度字段（`progressPercent` 等）更适合细粒度进度条。  
4. 统一 create，方便全站参数协议收敛。

**缺点**

1. 实现与协作逻辑更重，难测。  
2. 「无字段变化 → 变慢」时，用户可能觉得进度条更新钝。  
3. 连败直接失败，不如 TapNow 的「暂停可重试」友好。

### 3.4 TapNow 相对 LibTV

**优点**

1. **全局任务表 + Provider** 结构清晰，和 UI 节点解耦。  
2. GET + ids 批查语义简单；`final_task_id` 支持任务接力。  
3. **3 次失败暂停 + Retry**，避免误杀长尾任务。  
4. Create 按媒体拆分，后端团队边界清楚。  
5. 后台桌面通知，长等待体验好。

**缺点**

1. 固定 ~5s，短生成「完成感知」可能慢于 LibTV 的 2s。  
2. 无进展退避，大量慢任务仍保持 5s 一拍（不如 LibTV 省）。  
3. 内存 Map 与节点 `taskInfo` 双写，恢复要靠 recoverable，漏接易丢轮询。  
4. Create 多入口，客户端 adapter 面更大。

---

## 4. 本项目优缺点（相对两家）

### 优点

1. 实现简单、单测清晰。  
2. 节点解耦，单节点异常不拖垮全局。  
3. 已有 32ms batch + 时钟对齐，多节点时常能合成 1 次请求。  
4. 双通道恢复（`taskInfo` + localStorage）。  

### 缺点

1. 合并非契约，扩到全节点后错位/多拍风险上升。  
2. 无退避、无全局熔断分级。  
3. 每类型复制 timer 会爆炸。  
4. 协议与 LibTV/TapNow 都未完全同源。  

---

## 5. 谁更好？对 AImanju 的建议

| 目标 | 更参考谁 |
|------|----------|
| 多节点成本确定、省流 | **LibTV**（退避） |
| 结构清晰、失败可恢复 UX | **TapNow**（任务 Map + Provider + Retry 暂停） |
| 快速落地单类型 | 本项目现状 |

**推荐组合（比单纯抄任一家更稳）：**

1. **调度层像 TapNow / LibTV**：画布（或 App）级唯一 Poller，禁止每节点 timer。  
2. **任务登记像 TapNow**：显式 pending 任务表（或与节点 `taskInfo` 单源同步）。  
3. **节奏像 LibTV**：基础 2s + 无变化退避到 30s（短任务敏感觉 + 长任务省流）。  
4. **失败 UX 像 TapNow**：先暂停可重试，达到更高阈值再标失败。  
5. **Create**：可继续统一 `create`（偏 LibTV），不必拆成四套 endpoint。  

一句话：

> **调度中心化双方都对**；LibTV 更会「过日子（退避）」，TapNow 更会「管任务（Map + 暂停重试）」。本项目应吸收两者，而不是把现有每节点轮询铺开。

---

## 6. 若按现有方式全面铺开：上线风险

| 风险 | 说明 | 严重度 |
|------|------|--------|
| 合并不可靠 | 图/视频启动与恢复时序不同，易拆成多拍请求 | 中高 |
| QPS 随节点数 × 时长线性涨 | 固定 2s、无退避；多任务卡住时持续高压 | 高 |
| 逻辑复制 | 超时、失败码、进度字段各写一套 → 线上怪 bug | 高 |
| 刷新恢复不一致 | 漏写 `taskInfo`/storage → 幽灵 loading 或丢任务 | 中高 |
| Batch 共享失败 | 一轮 HTTP 失败，同批 waiter 一起 reject；无分级熔断 | 中 |
| 协议分叉 | 后端若对齐 LibTV/`progresses` 或 TapNow/`tasks`，各节点解析再分叉 | 中 |

**粗判：** Demo / 少量并发可用；日活多节点并发生成有中等以上风险。两家生产系统都选择了**全局 Poller**，侧面印证不宜把「每节点 timer」铺全站。

---

## 7. 推荐演进方式

### 7.1 目标形态

建设画布级 **`GenerationProgressPoller`（可吸收 TapNow Task Map）：**

- **输入**：全画布 `loading/pending + taskId`（或独立 pending Map）  
- **每拍**：一次状态查询（POST progress 或 GET tasks，与后端协议定一种）  
- **分发**：按 taskId 写回  
- **节奏**：2s 起 + 无变化退避到 30s；任务增删尽快再拉  
- **失败**：连续 N 次暂停可重试，再升级为失败  
- **节点**：只负责 create → 登记 taskId → 完成写结果  

### 7.2 落地路径

| 阶段 | 做什么 | 风险 |
|------|--------|------|
| 现在 | 文本继续用现有 batcher | 低 |
| 下一步 | 抽共享「进度协议解析 + 批量请求」 | 低 |
| 再下一步 | 上画布级 Poller（+ 可选任务 Map）；删节点内 timer | 中 |
| 新节点 | **只接 Poller，禁止再复制 poll** | 最低 |

---

## 8. 相关代码位置（本项目）

| 路径 | 说明 |
|------|------|
| `components/flow/text/composables/useTextNodeGeneration.ts` | 文本节点创建任务、轮询、恢复 |
| `utils/flow/generationTaskProgressBatcher.ts` | 32ms 窗口合并 `task_ids` |
| `utils/flow/generationTaskResponse.ts` | 进度响应归一化 |
| `api/task-generation/index.ts` | `create` / `progress` API 封装 |

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-14 | 初稿：对照 LibTV 与本项目文本轮询 |
| 2026-07-14 | 增补 TapNow 创建/轮询逆向，三者对照与演进建议 |
