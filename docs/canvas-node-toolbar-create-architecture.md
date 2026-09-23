# 画布节点上方工具栏 · 统一 Create 架构

> 用途：为图片、视频、音频节点上方工具栏的单元功能提供统一入参、出参和分层方案。  
> 竞品参考：[`LibTV-图片节点-工具栏接口参数对照表.xlsx`](./LibTV-图片节点-工具栏接口参数对照表.xlsx)、[`LibTV-视频节点-工具栏接口参数对照表.xlsx`](./LibTV-视频节点-工具栏接口参数对照表.xlsx)、[`LibTV-音频节点-工具栏接口参数对照表.xlsx`](./LibTV-音频节点-工具栏接口参数对照表.xlsx)。  
> 项目基准：现有 `/task/generation/create`、`/node/credit`、`buildGenerationCreateRequest`、`buildFlowNodeCreditRequest`、`generationTasks` 任务中心。

## 1. 目标

后续图片 / 视频 / 音频上方工具栏只要涉及模型推理，都必须收敛到同一套 create 链路：

```text
Toolbar UI
  → ToolbarGenerationIntent
  → Capability 选型与 Schema 校验
  → 目标节点准备（当前节点或派生节点）
  → 统一 CreateGenerationTaskRequest
  → /node/credit 与 /task/generation/create 同源
  → 后端 Provider Adapter
  → progress 轮询
  → task coordinator 统一回写节点
```

核心原则：

- 前端只提交业务字段，不提交 LibTV / 厂商原始字段。
- `parameters` 只放模型 Schema 声明的普通标量。
- `features` 只放工具栏复杂交互产物，例如蒙版、裁剪区域、光源、时间段、分离轨道。
- `quote`、`create`、节点保存必须来自同一份规范化 generation 配置。
- 派生类工具栏功能默认先创建目标节点，再以目标节点 `serverNodeId` 发起 create。
- 本地确定性功能不走 create，例如裁剪、标注、旋转、普通剪辑、下载。

## 2. 功能分类

### 2.1 UI-only

只改变前端状态或打开面板，不调用 create。

| 类型 | 示例 | 保存 |
|---|---|---|
| 打开面板 | 图片重绘面板、视频剪辑面板、音频调速面板 | 不立即保存或只保存 UI 草稿 |
| 切换工具态 | 画笔 / 橡皮 / 框选 / 文本标注 | 不创建任务 |
| 展示控制 | 展开工具栏、打开参数 Popover | 不创建任务 |

### 2.2 Local Media Transform

确定性处理，不需要模型推理。

```text
本地 Canvas / Media 处理
  → 生成 File / Blob
  → 上传 OSS
  → 创建派生节点或更新当前节点
  → /node/batch 保存
```

| 节点 | 功能 | 处理方式 |
|---|---|---|
| 图片 | 裁剪、标注、旋转、镜像、纯宫格切分 | Canvas 导出 + OSS + 节点保存 |
| 视频 | 普通剪辑、截帧、下载 | 本地导出/截图 + OSS + 节点保存 |
| 音频 | 普通裁剪、普通调速、下载 | 本地导出 + OSS + 节点保存 |

### 2.3 Model Generation

需要模型推理，统一走 create。

| 节点 | 示例 |
|---|---|
| 图片 | 高清、重绘、擦除、扩图、打光、多角度、720 全景、Slash、抠图、风格迁移 |
| 视频 | 高清、去字幕/去水印、补帧、视频增强、音频驱动视频、首尾帧生成视频 |
| 音频 | 降噪、分离、音色转换、文本转音频、音频续写 |

## 3. 前端意图层

工具栏组件不直接拼 create body，只产出 `ToolbarGenerationIntent`。

```ts
type ToolbarGenerationIntent = {
  /** 工具栏功能唯一键，供埋点、路由和测试使用 */
  actionKey: string
  /** 发起功能的源节点 uuid */
  sourceNodeId: string
  /** 结果写回策略 */
  outputPolicy: 'replaceCurrent' | 'deriveNode' | 'appendResult'
  /** 目标输出节点类型 */
  targetNodeType: 'image' | 'video' | 'audio' | 'text'
  /** 业务生成模式；必须与 capability.mode_type 对齐 */
  modeType: string
  /** 业务场景；后端 Adapter 可映射为 LibTV scene 或厂商 scene */
  scene: string
  /** 当前功能需要的输入覆盖 */
  inputs?: Partial<GenerationTaskInputs>
  /** 当前功能需要的参数覆盖；最终还要按 Schema 过滤 */
  parameterOverrides?: Record<string, GenerationParameterValue>
  /** 当前功能产出的复杂结构 */
  features?: Record<string, unknown>
  /** 目标节点标题；派生节点使用 */
  targetTitle?: string
}
```

这层只表达“用户做了什么”，不包含 `provider`、厂商模型名、LibTV `params`、`metadata`。

## 4. 统一 Create 入参

最终发送给 `/task/generation/create` 的结构保持项目现有协议，并补齐媒体输入对象能力。

```ts
type CreateGenerationTaskRequest = {
  request_id?: string
  drama_id: number
  canvas_id: number
  /** 结果回写目标节点的服务端 id */
  node_id: number
  /** 目标节点类型 */
  node_type: 'image' | 'video' | 'audio' | 'text' | 'script'
  /** 任务输出类型 */
  task_type: 'image' | 'video' | 'audio' | 'text'
  model_code: string
  capability_id?: string
  mode_type?: string
  schema_version?: number
  model_revision?: number
  scene: string
  inputs: GenerationTaskInputs
  parameters: Record<string, GenerationParameterValue>
  features: Record<string, unknown>
}

type GenerationTaskInputs = {
  prompt: string
  images: Array<string | MediaInput>
  videos: Array<string | MediaInput>
  audios: Array<string | MediaInput>
  texts: string[]
}

type MediaInput = {
  url: string
  role?: 'source' | 'reference' | 'mask' | 'composite' | 'style' | 'first_frame' | 'last_frame'
  node_id?: number
  node_uuid?: string
  asset_id?: string
  label?: string
  width?: number
  height?: number
  duration?: number
  mime_type?: string
}
```

字段规则：

- `node_id` 是结果回写目标节点，不一定是源节点。
- `sourceNodeId` 不进入外层；源节点通过 `inputs.*[].node_uuid` 和 `role=source` 表达。
- `mode_type` 要拆成业务功能级别，例如 `image_inpaint`、`image_upscale`，不要全部挤进 `image2image`。
- `scene` 保留业务语义，例如 `redraw`、`erase`、`upscaler`、`light-control`，方便后端 Adapter 映射。
- `parameters` 只保留当前 capability 声明的 key。
- `features` 只保留当前 capability 白名单声明的 feature key。
- 不支持的字段直接省略，禁止传 `none`、`0`、空字符串表达“不支持”。

## 5. 出参架构

create 只负责创建任务，不直接承担所有结果回写。

```ts
type CreateGenerationTaskResponse = {
  code: number
  message?: string
  msg?: string
  data?: {
    task_id?: string | number
    taskId?: string | number
    request_id?: string
    node_id?: number
    node_type?: string
    task_type?: string
    status?: 'queued' | 'running' | 'completed'
    progress?: number
    /** 同步类 Adapter 可直接返回；异步任务可为空 */
    result?: GenerationResult
  }
}

type GenerationResult = {
  outputs: {
    images?: MediaOutput[]
    videos?: MediaOutput[]
    audios?: MediaOutput[]
    texts?: string[]
  }
  metadata?: Record<string, unknown>
}

type MediaOutput = {
  url: string
  preview_url?: string
  cover_url?: string
  width?: number
  height?: number
  duration?: number
  mime_type?: string
  asset_id?: string
}
```

progress 接口应归一成同一份快照：

```ts
type GenerationProgressSnapshot = {
  task_id: string
  node_id?: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled'
  progress: number
  result?: GenerationResult
  error_message?: string
}
```

前端任务中心只消费归一结果：

- `completed`：根据 `task_type` 写回 `url / urls / assetUrl / duration / resourceMeta`。
- `failed`：写回 `taskInfo.status=failed`、`error`。
- `running`：只更新进度，不覆盖用户输入。
- `canceled`：保持取消态，忽略迟到的成功结果。

## 6. Capability Schema

工具栏能力应由后端声明，前端按能力展示和提交。

```ts
type NodeToolbarCapability = {
  capability_id: string
  node_type: 'image' | 'video' | 'audio'
  task_type: 'image' | 'video' | 'audio'
  mode_type: string
  scene: string
  model_code: string
  entry_points: Array<'top_toolbar' | 'prompt_panel' | 'quick_action'>
  input_schema: {
    prompt?: { required?: boolean }
    images?: { min?: number, max?: number, roles?: string[] }
    videos?: { min?: number, max?: number, roles?: string[] }
    audios?: { min?: number, max?: number, roles?: string[] }
    texts?: { min?: number, max?: number }
  }
  parameters: NodeModelParameterSchema[]
  feature_keys: string[]
  output_policy: 'replaceCurrent' | 'deriveNode' | 'appendResult'
  default_target_title?: string
}
```

前端展示规则：

- 没有 capability：工具栏入口隐藏或置灰。
- 输入不满足 `input_schema`：入口置灰并提示原因。
- capability 不声明的 parameter：UI 不展示、不保存、不提交。
- capability 不声明的 feature：功能不可发起。

## 7. 图片工具栏映射

| 功能 | 是否走 create | 建议 `mode_type` | `scene` | `parameters` | `features` | 目标节点 |
|---|---|---|---|---|---|---|
| 720 全景 | 是 | `image_panorama_720` | `720_panoramic` / `720_panoramic_with_prompt` | `resolution`、`ratio`、`count` | `panorama_720_v1` | 派生图片 |
| 多角度 | 是 | `image_multi_angle` | `multi_angle` | 无或 Schema 声明 | `multi_angle_v1` | 派生图片 |
| 打光 | 是 | `image_light_control` | `light-control` | 无或 Schema 声明 | `light_control_v1` | 派生图片 |
| 九宫格 / Slash | 是 | `image_slash_preset` | Slash scene key | `resolution`、`ratio`、`count` | `slash_preset_v1` | 派生图片或分镜组 |
| 高清 | 是 | `image_upscale` | `upscaler` | `target_resolution` 或 `scale` | `image_upscale_v1` | 派生图片 |
| 扩图 | 是 | `image_outpaint` | `expand-image` | `resolution`、`ratio`、`count` | `outpaint_v1` | 派生图片 |
| 重绘 | 是 | `image_inpaint` | `redraw` | `resolution`、`ratio`、`count` | `inpaint_mask_v1` | 派生图片 |
| 擦除 | 是 | `image_erase` | `erase` | `resolution`、`ratio`、`count` | `erase_mask_v1` | 派生图片 |
| 抠图 | 建议走 create 包装 | `image_remove_background` | `remove-background` | 无 | `matting_v1` | 派生图片 |
| 风格迁移 | 是 | `image_style_transfer` | `style-transfer` | 按 Schema | `style_transfer_v1` | 派生图片 |
| Mockup | 是 | `image_mockup` | `mockup` | 按 Schema | `mockup_v1` | 派生图片 |
| 编辑元素 | 是 | `image_edit_elements` | `edit-elements` | 按 Schema | `edit_elements_v1` | 派生图片 |
| 编辑文本 | 是 | `image_edit_texts` | `edit-texts` | 按 Schema | `edit_texts_v1` | 派生图片 |
| 镜头聚焦 | 是 | `image_camera_focus` | `camera_focus` | `ratio` | `camera_focus_v1` | 派生图片 |
| 补全画幅 | 是 | `image_scene_completion` | `scene_completion` | `ratio` | `scene_completion_v1` | 派生图片 |
| 裁剪 | 否 | — | — | — | — | 本地派生图片 |
| 标注 | 否 | — | — | — | — | 本地派生图片 |
| 旋转 / 镜像 | 否 | — | — | — | — | 本地派生图片或替换当前 |
| 纯宫格切分 | 否 | — | — | — | — | 本地分镜组 / 图片节点 |

## 8. 视频工具栏映射

| 功能 | 是否走 create | 建议 `mode_type` | `scene` | `features` | 目标节点 |
|---|---|---|---|---|---|
| 高清 / 增强 | 是 | `video_upscale` | `video-upscale` | `video_upscale_v1` | 派生视频 |
| 去字幕 / 去水印 | 是 | `video_subtitle_erase` | `subtitle-erase` | `video_erase_region_v1` | 派生视频 |
| 补帧 / 插帧 | 是 | `video_frame_interpolation` | `frame-interpolation` | `video_interpolation_v1` | 派生视频 |
| 视频风格化 | 是 | `video_style_transfer` | `video-style-transfer` | `video_style_transfer_v1` | 派生视频 |
| 视频剪辑 | 否 | — | — | — | 本地导出派生视频 |
| 截取帧数 | 否 | — | — | — | 本地派生图片 |
| 下载 | 否 | — | — | — | 无 |

## 9. 音频工具栏映射

| 功能 | 是否走 create | 建议 `mode_type` | `scene` | `features` | 目标节点 |
|---|---|---|---|---|---|
| 音频降噪 | 是 | `audio_denoise` | `audio-denoise` | `audio_denoise_v1` | 派生音频 |
| 音频分离 | 是 | `audio_separation` | `audio-separation` | `audio_separation_v1` | 派生音频或多音轨节点 |
| 音色转换 | 是 | `audio_voice_convert` | `voice-convert` | `voice_convert_v1` | 派生音频 |
| 文本转音频 | 是 | `text2audio` | `text-to-audio` | `voice_config_v1` | 当前或派生音频 |
| 裁剪 | 否 | — | — | — | 本地派生音频 |
| 调速 | 否，若普通变速 | — | — | — | 本地派生音频 |
| 下载 | 否 | — | — | — | 无 |

## 10. 接入步骤

每个工具栏单元功能都按同一流程接入。

1. 定义 capability：
   - `node_type`
   - `task_type`
   - `mode_type`
   - `scene`
   - `parameters`
   - `feature_keys`
   - `input_schema`
   - `output_policy`

2. 定义前端 intent：
   - `actionKey`
   - `sourceNodeId`
   - `targetNodeType`
   - `modeType`
   - `scene`
   - `parameterOverrides`
   - `features`

3. 准备目标节点：
   - `replaceCurrent`：使用当前节点 server id。
   - `deriveNode`：先通过画布事务创建派生节点并保存，拿到 server id 后再 create。
   - `appendResult`：使用当前节点，结果追加到 `urls` 或结果列表。

4. 构建 request：
   - 从源节点和上游连线收集 `inputs`。
   - 合并节点 generation 参数与 intent overrides。
   - 按 capability 过滤 `parameters` 和 `features`。
   - 复用同一个 builder 供 `/node/credit` 和 `/task/generation/create`。

5. 创建任务：
   - 创建前 `flushWorkflowSave`。
   - 成功后写入 `taskInfo`。
   - 交给 `generationTasks.trackCreatedTask`。

6. 回写结果：
   - progress 归一后由任务中心按 `task_type` 写回目标节点。
   - 工具栏组件不直接解析厂商结果。

## 11. 后端 Adapter 职责

后端是模型执行真相源，必须二次校验。

后端接收统一 create 后：

1. 根据 `model_code + capability_id / mode_type` 找到能力。
2. 校验 `inputs` 数量、类型、role。
3. 校验 `parameters` key、枚举、范围、必填项。
4. 校验 `features` 白名单与结构。
5. 将业务字段映射为厂商字段。
6. 写入任务记录，返回统一 `task_id`。

Adapter 示例：

| 本项目字段 | LibTV / 厂商字段 |
|---|---|
| `scene: "redraw"` | `params.scene = "redraw"` |
| `inputs.images[role=source].url` | `originImage` 或 `imageList` |
| `features.inpaint_mask_v1.mask_url` | `mark` |
| `features.light_control_v1.key_light` | `UI_KeyLight` |
| `parameters.resolution` | `settings.resolution` 或 `quality` |
| `parameters.count` | `count` 或 `n` |

前端禁止直接提交这些厂商字段：`provider`、`params`、`settings`、`originImage`、`mark`、`UI_KeyLight`、`modeType`。

## 12. 示例

### 12.1 图片重绘

```json
{
  "drama_id": 59,
  "canvas_id": 37,
  "node_id": 3013,
  "node_type": "image",
  "task_type": "image",
  "model_code": "lib-image-2",
  "capability_id": "cap-image-inpaint-v1",
  "mode_type": "image_inpaint",
  "scene": "redraw",
  "inputs": {
    "prompt": "把选中区域改成夜景",
    "images": [
      {
        "url": "https://oss.example.com/source.png",
        "role": "source",
        "node_uuid": "image-source"
      }
    ],
    "videos": [],
    "audios": [],
    "texts": []
  },
  "parameters": {
    "count": 1,
    "resolution": "2K",
    "ratio": "16:9"
  },
  "features": {
    "inpaint_mask_v1": {
      "mask_url": "https://oss.example.com/mask.png",
      "mask_format": "alpha",
      "source_width": 1920,
      "source_height": 1080
    }
  }
}
```

### 12.2 图片打光

```json
{
  "node_type": "image",
  "task_type": "image",
  "model_code": "nebula-ultra",
  "capability_id": "cap-image-light-control-v1",
  "mode_type": "image_light_control",
  "scene": "light-control",
  "inputs": {
    "prompt": "暖色侧光",
    "images": [
      { "url": "https://oss.example.com/source.png", "role": "source" },
      { "url": "https://oss.example.com/light-ref.png", "role": "reference" }
    ],
    "videos": [],
    "audios": [],
    "texts": []
  },
  "parameters": {},
  "features": {
    "light_control_v1": {
      "key_light": "High-Front",
      "light_color": "#ffffff",
      "brightness": 50,
      "rim_light": "Back"
    }
  }
}
```

### 12.3 视频高清

```json
{
  "node_type": "video",
  "task_type": "video",
  "model_code": "video-enhance",
  "capability_id": "cap-video-upscale-v1",
  "mode_type": "video_upscale",
  "scene": "video-upscale",
  "inputs": {
    "prompt": "",
    "images": [],
    "videos": [
      { "url": "https://oss.example.com/source.mp4", "role": "source", "duration": 3.2 }
    ],
    "audios": [],
    "texts": []
  },
  "parameters": {
    "resolution": "1080P"
  },
  "features": {
    "video_upscale_v1": {
      "preserve_audio": true
    }
  }
}
```

### 12.4 音频分离

```json
{
  "node_type": "audio",
  "task_type": "audio",
  "model_code": "audio-separation",
  "capability_id": "cap-audio-separation-v1",
  "mode_type": "audio_separation",
  "scene": "audio-separation",
  "inputs": {
    "prompt": "",
    "images": [],
    "videos": [],
    "audios": [
      { "url": "https://oss.example.com/source.wav", "role": "source", "duration": 16.8 }
    ],
    "texts": []
  },
  "parameters": {},
  "features": {
    "audio_separation_v1": {
      "stems": ["vocal", "instrumental"]
    }
  }
}
```

## 13. 测试要求

每个单元功能最少补这些测试：

| 层级 | 必测点 |
|---|---|
| 单元测试 | intent 构建、参数过滤、feature 结构、输入 role |
| 集成测试 | 派生节点创建、保存后 create、taskInfo 写入、失败回滚 |
| E2E | 关键用户路径：点击工具栏、确认生成、节点进入 loading、结果回写 |
| 协议测试 | `/node/credit` 与 `/task/generation/create` body 完全一致 |
| 回归测试 | 模型不支持参数时 UI 不展示且请求不含字段 |

验收清单：

- [ ] 工具栏入口由 capability 控制显隐 / 禁用。
- [ ] 不按 `model_code` 特判 UI 或请求字段。
- [ ] `parameters` 只提交 Schema 声明的 key。
- [ ] `features` 只提交当前功能声明的 feature key。
- [ ] 派生类功能先创建目标节点，再 create。
- [ ] create 失败不会留下半成品 loading 状态。
- [ ] quote/create/节点保存三者的模型配置同源。
- [ ] progress 结果由任务中心统一回写。
- [ ] 本地功能不误调用 create。

## 14. 落地顺序

推荐按风险从低到高接入：

1. 图片高清：输入简单，验证派生节点 + create + 回写。
2. 图片重绘 / 擦除：引入 mask feature，验证复杂 feature。
3. 图片扩图 / 打光 / 多角度：验证不同 feature 组件注册。
4. 视频高清 / 去字幕：验证视频输出。
5. 音频降噪 / 分离：验证音频输出和多结果。
6. 抠图：建议后端包装成 create，同步结果也通过统一 response 回写。

