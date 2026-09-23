# LibTV 画布节点连线规则

> 面向产品 / 前端对齐使用。规则来自 LibTV 线上前端静态资源（2026-06），**非官方文档**，后续 LibTV 升级可能变化。  
> 主要源码位置：`0zcqss3kicfs6.js`（连线矩阵与校验）、`06y8ms5eb3qy2.js`（`isValidConnection` 与画布状态）。

---

## 1. 架构概览

LibTV 连线校验分三层，顺序固定：

```
用户操作（拖 handle / 预打组迁出 / 快捷键）
  → 画布状态门控（锁定、只读、特殊模式）
  → u()：源 action → 目标 action（静态矩阵 connections）
  → isValidConnection：拓扑与边级规则（重复边、成环、特殊类型）
  → validateGeneratorConnection：模型 / 数量 / 素材深度校验
  → 创建边
```

**连线方向**：始终是 **源节点 `source`（out）→ 目标节点 `target`（in）**，数据从上游流向下游。

**核心函数对照**：

| 函数 | 作用 |
|------|------|
| `u(source, target)` | 将节点类型推断为 `NodeAction`，查 `connections` 矩阵 |
| `validateGeneratorConnection(source, target)` | 单对节点深度校验（模型、素材、数量） |
| `validateMultiSelectConnection(sources[], target)` | 预打组批量连到已有节点 |
| `canMultiSelectCreateNode(sources[], nodeType)` | 预打组迁出后生成新节点是否允许 |
| `canCreateNodeType(action, nodeType)` | 从空白处 spawn 菜单是否显示某类型 |
| `isValidConnection(connection)` | React Flow 拖线时的总入口 |

---

## 2. NodeAction 推断

节点 `data.action` 为空时，按类型与内容自动推断源/目标的 action：

| 节点类型 | 推断规则 |
|---------|---------|
| `TEXT` | `TEXT_GENERATE` |
| `IMAGE`（含 `scriptRowHiddenUuid`） | `IMAGE_GENERATE` |
| `VIDEO`（`url` 数组非空） | `VIDEO_RESOURCE` |
| `VIDEO`（无 url） | `VIDEO_GENERATE` |
| `VIDEO_CLIP` | `VIDEO_CLIP_RESOURCE` |
| `SPACE_SCENE_720` / `DIRECTOR_CONSOLE_3D` | `DIRECTOR_CONSOLE_PANORAMA_INPUT` |

推断后的 action 作为矩阵行/列键参与 `connections[sourceAction][targetAction]` 查询。

---

## 3. 静态连线矩阵（connections）

矩阵定义在模块 `591290`，注释为：**「节点 action 之间的连线关系映射表，true 表示可以连接」**。

键名缩写（下文表格用）：

| 缩写 | 完整 action |
|------|-------------|
| `tg` | `text_generate` |
| `tr` | `text_resource` |
| `ig` | `image_generate` |
| `ie` | `image_edit` |
| `ir` | `image_resource` |
| `vg` | `video_generate` |
| `ve` | `video_edit` |
| `vr` | `video_resource` |
| `vc` | `video_clip_resource` |
| `ag` | `audio_generate` |
| `ar` | `audio_resource` |
| `sg` | `script_generate` |
| `sr` | `script_resource` |
| `vs` | `video_story_resource` |
| `ms` | `material_style_resource` |
| `ml` | `material_lens_resource` |
| `rf` | `reference_node` |
| `dc` | `director_console_panorama_input` |

### 3.1 永远不能作为连线目标的节点

以下类型在代码中 `actions = []`，**没有 in 端口语义，不可作 target**：

| 节点类型 | 说明 |
|---------|------|
| `GROUP` | 组壳 |
| `VIDEO_GROUP` | 视频组壳 |
| `CUSTOM` | 自定义节点 |

### 3.2 永远不能作为连线源的 action

以下 action 在矩阵中**整行均为 false**，对应节点不可作 source：

| 源 action | 说明 |
|-----------|------|
| `script_generate` / `script_resource` | 脚本节点不能向外连线 |
| `video_story_resource` | 视频故事节点不能向外连线 |
| `director_console_panorama_input` | 全景输入只能作目标，不能作源 |

### 3.3 完整矩阵（源 action → 目标 action）

`✓` = 允许，`✗` = 禁止。

| 源 ↓ / 目标 → | tg | tr | ig | ie | ir | vg | ve | vr | vc | ag | ar | sg | sr | vs | ms | ml | rf | dc |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| text_generate | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| text_resource | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| image_generate | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| image_edit | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| image_resource | ✓ | ✗ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| video_generate | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| video_edit | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| video_resource | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| video_clip_resource | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| audio_generate | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| audio_resource | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| script_generate | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| script_resource | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| video_story_resource | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| material_style_resource | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| material_lens_resource | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| reference_node | ✓ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| director_console_panorama_input | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### 3.4 按目标类型速查：谁能连进来

| 目标类型 / action | 允许的源 action |
|------------------|----------------|
| **TEXT**（`TEXT_GENERATE` / `TEXT_RESOURCE`） | 文本、图片生成、视频生成/编辑、音频生成、脚本生成 |
| **IMAGE**（生成/编辑/资源） | 文本、图片（全部）、视频生成/编辑、脚本生成、风格素材 |
| **VIDEO**（生成/编辑/资源） | 文本、图片（全部）、视频（全部）、镜头素材 |
| **VIDEO_CLIP**（合成） | 文本、视频（生成/编辑/资源）、音频（生成/资源） |
| **AUDIO** | 矩阵无入边（音频节点不能作 target） |
| **SCRIPT** / **SCRIPT_V2** | 矩阵无入边（脚本节点不能作 target） |
| **REFERENCE** | 文本、图片生成、视频生成/编辑、音频生成、脚本生成、REFERENCE |
| **SPACE_SCENE_720** | 仅 `director_console_panorama_input`（来自图片类源） |

### 3.5 按源类型速查：能连到哪里

| 源类型 / action | 可连目标 action |
|----------------|----------------|
| **TEXT** | 文本、图片生成、视频生成/编辑、音频生成、脚本生成 |
| **IMAGE** | 文本、图片（全部）、视频生成/编辑、脚本生成、全景输入 |
| **VIDEO** | 文本、视频（全部）、视频合成、脚本生成 |
| **AUDIO** | 仅视频生成/编辑、视频合成 |
| **MATERIAL_STYLE** | 图片生成/编辑、脚本生成 |
| **MATERIAL_LENS** | 仅视频生成 |
| **REFERENCE** | 文本、图片生成、视频生成/编辑、音频生成、脚本生成、REFERENCE |

---

## 4. 深度校验（validateGeneratorConnection）

矩阵为 `true` 后，仍可能被以下规则拒绝。

### 4.1 REFERENCE 节点

| 场景 | 规则 |
|------|------|
| 目标为 `REFERENCE` | 源必须也是 `REFERENCE` |
| 源为 `REFERENCE` | 可连向任意目标（仍须过矩阵） |
| 预打组批量迁出 | `REFERENCE` **不参与**校验与建边（`Q.current` 过滤） |

### 4.2 ENHANCE（增强）节点

`generatorType === ENHANCE` 时：

| 目标类型 | 源类型限制 | 入边数量 |
|---------|-----------|---------|
| 图片增强 | 源必须是 `IMAGE` | 已有 ≥1 条入边则拒绝 |
| 视频增强 | 源必须是 `VIDEO` | 已有 ≥1 条入边则拒绝 |

### 4.3 视频生成目标（VIDEO_GENERATE）

- 源类型限：`IMAGE` / `VIDEO` / `AUDIO` / `TEXT`
- 合并**已有入边 + 新源**后校验：
  - `isModelEnabledForMedia`：当前/候选模型是否支持该媒体组合
  - `isWithinSubjectSharedLimit`：subject 数量是否超过模型 schema（`maxCount` / `maxCountWithVideo` / `sharedWith`）
- 校验通过且需换模型时，返回 `switchToModel`

### 4.4 图片生成目标（IMAGE_GENERATE）

- 源为 `IMAGE` 时：合并 `imageList`（含 `refImages`）后走 `canAcceptImageConnection`
- 已有入边含 **video / audio** → 直接拒绝

### 4.5 文本生成目标（TEXT_GENERATE）

| 源类型 | 规则 |
|--------|------|
| `IMAGE` | 合并后 `imageList.length ≤ getTextImageMaxCount`（默认 **1**，随文本模型 schema `image2text` 变化） |
| `VIDEO` | 合并后 `videoList.length ≤ getTextVideoMaxCount`（默认 **0**，随 `video2text` 变化） |
| `TEXT` | 允许 |
| 其他 | 拒绝 |
| `TEXT_RESOURCE` 目标 | **一律不可连** |

### 4.6 脚本 / 视频合成目标

- `SCRIPT` / `SCRIPT_V2`（`SCRIPT_GENERATE`）与 `VIDEO_CLIP`（`VIDEO_CLIP_RESOURCE`）
- 批量连接时：**每个新源**单独跑 `validateGeneratorConnection`，任一失败则整体不允许

### 4.7 素材节点

| 连接 | 规则 |
|------|------|
| `MATERIAL_STYLE` → `IMAGE` | `fineTuneType` / `baseType` 与目标模型 schema 兼容；同目标风格槽位不超过 `maxCount` |
| `MATERIAL_STYLE` → `SCRIPT` | 同上，走 `scriptImage` schema 命名空间 |
| `MATERIAL_LENS` → `VIDEO` | 目标视频模型须支持 `lens`；`baseType` 有交集；同 `lensAssetUuid` 不重复；默认最多 **6** 路镜头（`lens.maxCount`） |

### 4.8 SCRIPT_V2 特殊限制

- `VIDEO` / `VIDEO_CLIP` 源 → `SCRIPT_V2` 目标：`u()` 直接返回 `false`
- 预打组 spawn 菜单：`SCRIPT_V2` 目标**不能**从选中集生成 `VIDEO` / `VIDEO_CLIP` 类节点（`canCreateNodeType` 拦截）

---

## 5. 拓扑与边级规则（isValidConnection）

即使类型矩阵通过，`isValidConnection` 仍会拒绝：

| 规则 | 说明 |
|------|------|
| **重复边** | 已存在同向或反向 `source↔target` 边 |
| **成环** | 在有向边图上 DFS 检测环；`REFERENCE` 源不参与环检测图构建 |
| **SCRIPT_V2 ↔ 分镜组** | `SCRIPT_V2` 与 `storyboardGroupType` 为 `image`/`video` 的 `GROUP` **互不可连** |
| **VIDEO_CLIP + 上传中媒体** | 源为 `blob:` URL 的 `VIDEO`/`AUDIO` → 拒绝并 toast |
| **VIDEO_CLIP 时间轴上限** | 非音频轨片段数达 `MAX_TIMELINE_VIDEO_CLIPS` 且该源未占用槽位 → 拒绝 |
| **协作锁** | 团队项目中源或目标节点被他人持锁（`nJ` / `nQ`）→ 拒绝 |

**文本目标入边数量**（在 `isValidConnection` 内额外检查）：

- 目标为 `TEXT` 且新源为 `IMAGE`：已有 `IMAGE` 入边数 ≥ `getTextImageMaxCount` → 拒绝
- 目标为 `TEXT` 且新源为 `VIDEO`：已有 `VIDEO` 入边数 ≥ `getTextVideoMaxCount` → 拒绝

---

## 6. 画布状态：何时可 / 不可连线

### 6.1 可以连线

- 画布未锁定（`!canvasLocked`）
- 非只读（`!isReadonly`）
- 非截图模式（`!isCanvasCaptureMode`）
- 非参考图拾取模式下的普通拖线（拾取模式走专用点击流程）
- 源、目标均非 `GROUP` / `VIDEO_GROUP` / `CUSTOM` 壳节点
- 通过矩阵 + 深度校验 + 拓扑校验

React Flow 配置：`nodesConnectable: !canvasLocked`（`tq`），并 merge 各子模式的 `*ReactFlowProps`。

### 6.2 不能连线

| 状态 | 机制 |
|------|------|
| **画布锁定** `canvasLocked` | `nodesConnectable: false` |
| **只读** `isReadonly` | 同上 |
| **截图模式** `isCanvasCaptureMode` | `nodesConnectable: false` |
| **标注模式** `isMarkMode` | 快捷键与部分交互禁用；`ph()` 返回 false |
| **参考图拾取** `isReferencePickMode` | 普通拖线关闭，改为点击 `referencePickableNodeIds` 内节点 |
| **协作远端锁** | 锁定节点不能作连线的源或目标 |
| **组过渡** `groupTransitionNodeIds` | 打组/解组动画期间交互受限 |

快捷键可用条件（`ph`）：`!canvasLocked && !isReadonly && !isMarkMode`。

---

## 7. 三种连线入口

| 入口 | 行为 | 数量限制 |
|------|------|---------|
| **单节点拖 handle** | 标准 `onConnectStart` → `isValidConnection` → `onConnect` | 单源单目标 |
| **预打组迁出连线**（工具栏 `+` 拖出） | `setConnectingSourceIds(全部 targetNodeIds)`；松手走 `onTryConnectAtDrop` / spawn 菜单 | **无固定上限**；实际受目标模型/schema 约束；排除 `REFERENCE` |
| **快捷键 Mod+L** | 选中恰好 **2** 个非 `GROUP` 节点互连 | 固定 2 个 |

预打组工具栏显示条件：`targetNodeIds.length >= 2`。

预打组 spawn 菜单可创建类型：`TEXT` / `IMAGE` / `VIDEO` / `VIDEO_CLIP` / `SCRIPT_V2`（各类型再经 `canMultiSelectCreateNode` 过滤）。

连到已有节点时：为每个尚未连到目标的选中节点各建一条边（去重跳过已存在边）。

---

## 8. 与 AImanju 当前实现的差异（备忘）

| 能力 | LibTV | AImanju（当前） |
|------|-------|----------------|
| action 矩阵 `connections` | 有 | 无 |
| `validateGeneratorConnection` 分层 | 有 | 部分（分镜等局部规则） |
| 成环检测 | 有 | 需确认 |
| 预打组批量迁出 | 全量源 + 模型校验 | `buildGroupingBatchEdges` 笛卡尔积，无上限/无矩阵 |
| `group` / `grouping` 拖线起点 | 壳节点无端口语义 | 已拦 `group` / `grouping` connect-start |
| 协作锁挡连线 | 有 | 有（`collab-locked-by-remote`） |

后续若对齐 LibTV，建议优先落地：`connections` 矩阵、`u()` action 推断、`validateGeneratorConnection`、环检测与画布状态门控。

---

## 9. 参考来源

| 资源 | 内容 |
|------|------|
| `…/chunks/0zcqss3kicfs6.js` | `connections` 矩阵、`u()`、`validateGeneratorConnection`、`validateMultiSelectConnection`、`canMultiSelectCreateNode` |
| `…/chunks/06y8ms5eb3qy2.js` | `isValidConnection`、`onConnect`、预打组 `sW`、画布状态、`canvas.connect` 快捷键 |
| `…/chunks/0h179q69nxf4-.js` | `isWithinSubjectSharedLimit`、`canAcceptConnection` |

CDN 前缀：`https://liblibai-web-static.liblib.cloud/liblibtv_online/static/_next/static/chunks/`

---

## 10. 相关文档

- [libtv-collaboration-reverse.md](./libtv-collaboration-reverse.md) — 多人协作：节点状态 / 锁定 / 共享边界

---

*文档版本：2026-06-17，基于 LibTV 线上前端整理。*
