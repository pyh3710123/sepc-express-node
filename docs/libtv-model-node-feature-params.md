# 画布节点功能与生成入参

> 用途：前后端确认画布节点功能、模型能力和生成请求字段。  
> 当前规则：`model_code + properties[].node_type` 定位能力；后续有多生成模式时再增加 `mode_type`。  
> 证据：LibTV 已登录画布静态 chunk（2026-07-20，`ElementTool` / `modeType*` / `scene` 枚举）+ `docs/LibTV-*-工具栏接口参数对照表.xlsx`。  
> 架构基准：[`model-capability-generation-architecture-rfc.md`](./model-capability-generation-architecture-rfc.md)

## 1. 统一请求

所有需要调用生成服务的功能使用同一外层结构：

```json
{
  "drama_id": 59,
  "canvas_id": 37,
  "node_id": 3013,
  "node_type": "text",
  "task_type": "text",
  "model_code": "qwen3.6-flash",
  "scene": "text_to_text",
  "inputs": {
    "prompt": "一只站在雪山上的猫",
    "images": [],
    "videos": [],
    "audios": [],
    "texts": []
  },
  "parameters": {},
  "features": {}
}
```

字段规则：

- `node_type`：当前画布节点类型；
- `task_type`：任务输出类型；
- `scene`：业务生成场景；
- `inputs`：固定为 `prompt/images/videos/audios/texts`；
- `parameters`：普通标量或枚举参数；
- `features`：蒙版、区域、时间轴、多对象等复杂参数；
- `request_id`、`capability_id`、`schema_version`、`model_revision`：有真实值后再提交；
- 模型未声明的字段不展示、不保存、不提交；
- 未使用的可选字段直接省略，不传 `0`、`none`、空字符串；
- 不再提交旧 `params` 容器和 `provider`；厂商原始字段由后端 Adapter 处理。

batch 外层协议保持不变；`model_code/scene/parameters/features` 直接写入 `nodes.create/update[].extra_data`。不再嵌套 `generation`，也不再读写旧 `params`。

## 2. 能力声明

后端在 `/api/node/models` 返回模型能力。现有 `properties[]` 每一项就是一个节点能力，字段保持接口现状：

```json
{
  "model_code": "model-code",
  "model_name": "模型名称",
  "properties": [
    {
      "node_type": "image",
      "cost_time": "2-3min",
      "delete_time": null,
      "parameters": [
        {
          "key": "image_quality",
          "tips": "图片质量",
          "default": 2,
          "options": [
            { "label": "低", "value": 1 },
            { "label": "中", "value": 2 },
            { "label": "高", "value": 3 }
          ]
        }
      ]
    }
  ]
}
```

前端根据命中能力的 `parameters[]` 渲染 UI。没有某个 `key` 就不显示、不保存、不提交。只有 `key/tips` 的 `translate` 等条目属于 UI 动作能力，不自动进入 create；详细约定见架构 RFC。

### 2.1 LibTV 画布节点类型清单（抓取）

| LibTV `NodeType` | 建议 `node_type` | 说明 |
|---|---|---|
| `TEXT` | `text` | 文本生成 / 富文本 |
| `IMAGE` | `image` | 图片生成 / 编辑 / 资源 |
| `VIDEO` | `video` | 视频生成 / 资源 |
| `AUDIO` | `audio` | 音频生成 / 资源 |
| `SCRIPT` / `SCRIPT_V2` | `script` | 脚本 / 分镜表 |
| `VIDEO_STORY` | `video_story` | 视频解析产出的故事表 |
| `VIDEO_CLIP` | `video_clip` | 时间轴合成 |
| `ENHANCE` | （常作 video 下游 generator） | 视频高清生成器类型 |
| `MATERIAL_STYLE` | `material_style` | 风格素材 |
| `MATERIAL_LENS` | `material_lens` | 镜头素材 |
| `REFERENCE` | `reference` | 参考节点 |
| `SPACE_SCENE_720` | `space_scene_720` | 720 全景场景 |
| `DIRECTOR_CONSOLE_3D` | `director_console` | 导演台 3D |
| `GROUP` / `VIDEO_GROUP` / `CUSTOM` | — | 壳节点，不进生成协议 |

LibTV `GeneratorType`：`DEFAULT` · `ENHANCE` · `SUBTITLE_ERASE` · `PICTURE_EDIT`。

LibTV 图片编辑 `ElementTool`（工具栏完整枚举）：

```text
Inpaint | Upscale | Outpaint | Crop | SmartRemove | Annotate | Angle
| RemoveBackground | StyleTransfer | Mockup | EditElements | EditTexts
| GridSplit | Light | RotateOrMirror | NineGridSlash
```

## 3. 图片节点功能

### 3.1 Generator 模式（动态模型）

| 画布功能 | LibTV 文案 / 标识 | `mode_type` | `inputs` | `parameters` | `features` |
|---|---|---|---|---|---|
| 文生图 | `modeTypeText2image` | `text2image` | `prompt` | `count`、`resolution`、`ratio`、`image_quality` | 无 |
| 图生图 | `modeTypeImage2image` | `image2image` | `prompt`、参考图 | `count`、`resolution`、`ratio`、`reference_strength` | 按模型声明 |

### 3.2 工具栏 AI 功能（固定或候选模型）

| 画布功能 | LibTV `ElementTool` / scene | `mode_type` | `inputs` | `parameters` | `features` |
|---|---|---|---|---|---|
| 重绘 | `Inpaint` / `scene=redraw` | `image2image` | 原图、`prompt` | `count`、`resolution`、`ratio` | `inpaint_mask_v1` |
| 擦除 | `SmartRemove` / `scene=erase` | `image2image` | 原图（或合成图） | `count`、`resolution`、`ratio` | `erase_mask_v1` |
| 扩图 | `Outpaint` / `scene=expand-image` | `image2image` | 原图、可选 `prompt` | `count`、`resolution`、`ratio` | `outpaint_v1` |
| 打光 | `Light` / `scene=light-control` | `image2image` | 原图、可选参考光效图 | — | `light_control_v1` |
| 多角度 | `Angle` / model=`multiple-angles` | `image2image` | 原图 | — | `multi_angle_v1` |
| 720° 全景 | `scene=720_panoramic(+_with_prompt)` | `image2image` | 原图、可选 `prompt` | `resolution`、`ratio` | `panorama_720_v1` |
| 九宫格 / Slash | `NineGridSlash` / 多 scene | `image2image` | 原图、可选 `prompt` | `resolution`、`ratio` | `slash_preset_v1` |
| 图片高清 | `Upscale` / `scene=upscaler` | `image2image` | 原图 | `target_resolution` | `image_upscale_v1` |
| 宫格格内高清 | `GridSplit` + Topaz | `image2image` | 格内图 | `scale` | `grid_cell_upscale_v1` |
| 抠图 | `RemoveBackground`（同步推理） | — | 原图 | — | 见 §7；或远期 `matting_v1` |
| 风格迁移 | `StyleTransfer` | `image2image` | 原图、风格参考 | 按模型声明 | `style_transfer_v1` |
| Mockup | `Mockup` | `image2image` | 原图、载体图 | 按模型声明 | `mockup_v1` |
| 编辑元素 | `EditElements` | `image2image` | 原图、选区/元素 | 按模型声明 | `edit_elements_v1` |
| 编辑文本 | `EditTexts` | `image2image` | 原图、文本区 | 按模型声明 | `edit_texts_v1` |
| 表情/情绪调整 | `scene=expression_adjustment` | `image2image` | 主图 + 角色参考图 | `count` | `expression_adjustment_v1` |
| 镜头聚焦 | `scene=camera_focus` | `image2image` | 原图 | `ratio` | `camera_focus_v1` |
| 补全画幅 | `scene=scene_completion` | `image2image` | 原图 | `ratio` | `scene_completion_v1`（Slash 标签 fillFrame） |

Slash / 九宫格常见 `scene`（进入 `slash_preset_v1.scene_key`）：

```text
multi_camera_grid_9
story_beat_grid_4
character_face_turnaround_3view
product_turnaround_3view
continuous_storyboard_grid_25
cinematic_lighting_correction
character_turnaround_3view
frame_prediction_plus_3s
frame_prediction_minus_5s
character_setting_sheet
scene_setting_sheet
product_setting_sheet
character_ref
scene_completion
```

### 3.3 图片功能示例：文生图

```json
{
  "node_type": "image",
  "mode_type": "text2image",
  "inputs": {
    "prompt": "一只站在雪山上的猫",
    "images": []
  },
  "parameters": {
    "count": 2,
    "resolution": "2k",
    "ratio": "16:9",
    "image_quality": 3
  },
  "features": {}
}
```

### 3.4 图片功能示例：重绘

```json
{
  "node_type": "image",
  "mode_type": "image2image",
  "inputs": {
    "prompt": "把标记区域改成夜景",
    "images": [{ "url": "<origin>", "role": "source" }]
  },
  "parameters": {
    "resolution": "2k"
  },
  "features": {
    "inpaint_mask_v1": {
      "mask_url": "<mask>"
    }
  }
}
```

### 3.5 图片功能示例：镜头聚焦

```json
{
  "node_type": "image",
  "mode_type": "image2image",
  "inputs": {
    "images": [{ "url": "<origin>", "role": "source" }]
  },
  "parameters": {
    "ratio": "16:9"
  },
  "features": {
    "camera_focus_v1": {
      "rel_x": 0.2,
      "rel_y": 0.2,
      "width": 0.4,
      "height": 0.4
    }
  }
}
```

功能映射（前端业务字段 → LibTV / Adapter）：

| `feature_key` | 前端输出 | 后端/LibTV 旧语义 |
|---|---|---|
| `inpaint_mask_v1` | `mask_url`、可选区域 | `scene=redraw`、`mark` |
| `erase_mask_v1` | `mask_url` 或合成图 | `scene=erase` |
| `outpaint_v1` | `pads`、目标比例 | `scene=expand-image` |
| `light_control_v1` | `key_light`、颜色、亮度、轮廓光 | `/lighting`、`scene=light-control`、`nebula-ultra` |
| `multi_angle_v1` | 水平角、垂直角、缩放 | `multiple-angles`、`horizontal_angle` 等 |
| `panorama_720_v1` | 是否带 prompt | `720_panoramic` / `720_panoramic_with_prompt` |
| `slash_preset_v1` | `scene_key`、`grid_type?` | Slash `scene=…` |
| `image_upscale_v1` | 目标分辨率 `2k/4k/8k` | `scene=upscaler`、provider `upscaler` |
| `grid_cell_upscale_v1` | `scale` 2\|4 | `topaz-image-upscaler` |
| `style_transfer_v1` | 风格参考图 / 强度 | `ElementTool.StyleTransfer`（Adapter 定 scene） |
| `mockup_v1` | 载体 / 贴图参数 | `ElementTool.Mockup` |
| `edit_elements_v1` | 元素选区与编辑指令 | `ElementTool.EditElements` |
| `edit_texts_v1` | 文本区与改写内容 | `ElementTool.EditTexts` |
| `expression_adjustment_v1` | 表情枚举、角色参考 | `scene=expression_adjustment`（常见 model `lib-image-2`） |
| `camera_focus_v1` | 相对矩形区域 | `scene=camera_focus` + `focusRegion` |
| `scene_completion_v1` | 补全目标比例 | `scene=scene_completion` |

前端使用统一业务字段，Adapter 再转换为 LibTV 字段。

## 4. 视频节点功能

### 4.1 生成模式（动态模型 + 媒体约束）

LibTV 文案来自 `modeType*`（已登录 locale）：

| 画布功能 | LibTV `modeType` | `mode_type` | `inputs` | `parameters` | `features` |
|---|---|---|---|---|---|
| 文生视频 | `Text2video` | `text2video` | `prompt` | `seconds`、`resolution`、`ratio`、`fps` | 按模型声明 |
| 全能参考 | `Mixed2video` | `mixed2video` | 文本、图片、视频、音频 | `seconds` 等 | 按模型声明 |
| 图生视频 | `SingleImage2video` | `singleImage2video` | 单图、`prompt` | `seconds`、`resolution` | 按模型声明 |
| 首尾帧 | `Frames2video` | `frames2video` | `prompt` | `seconds`、`resolution` | `first_last_frame_v1` |
| 图片参考 | `Image2video` | `image2video` | 多图、`prompt` | `seconds`、`resolution` | 按模型声明 |
| 首帧 | `FirstFrame` | `first_frame` | 首帧图、`prompt` | `seconds` | 按模型声明 |
| 视频参考 | `Video2video` | `video2video` | 视频、`prompt` | `seconds`、`resolution` | 按模型声明 |
| 视频编辑 | `VideoEdit2video` | `video_edit` | 视频、`prompt` | `seconds`、`resolution` | 按模型声明 |
| 音频参考 | `Audio2video` | `audio2video` | 音频、可选图、`prompt` | `seconds` | 按模型声明 |
| 音频驱动 | `Audio2videoDrive` | `audio2video_drive` | 音频、可选图、`prompt` | `seconds` | 按模型声明 |

启用条件见 [`LibTV-视频生成模式-按钮触发条件.md`](./LibTV-视频生成模式-按钮触发条件.md)：模型声明 mode ∧ 媒体数量落在 schema 区间。

### 4.2 工具栏 AI 功能

| 画布功能 | LibTV 标识 | `mode_type` | `inputs` | `parameters` | `features` |
|---|---|---|---|---|---|
| 视频高清 | `GeneratorType.ENHANCE` / `volcano-video-upscaler` | `video_enhance` | 视频 | `resolution`、`fps`、`scale` | `video_upscale_v1` |
| 智能去字幕 | `GeneratorType.SUBTITLE_ERASE` / `volcano-subtitle-eraser` | `video_subtitle_erase` | 视频 | — | `subtitle_erase_v1` |
| 解析 → 视频故事 | `scene=video-parsing` / `aurora-3-lite` | `video_parsing` | 视频 | — | 结果写入 `video_story` 节点 |
| 人声分离 | `taskType=vocal_split` | `vocal_split` | 视频（含音轨） | — | `vocal_split_v1` |

### 4.3 视频功能示例：首尾帧

```json
{
  "node_type": "video",
  "mode_type": "frames2video",
  "inputs": { "prompt": "两个人从远处走近", "images": [] },
  "parameters": { "seconds": 5 },
  "features": {
    "first_last_frame_v1": {
      "first_frame_asset_id": "asset-first",
      "last_frame_asset_id": "asset-last"
    }
  }
}
```

### 4.4 视频功能示例：区域去字幕

```json
{
  "node_type": "video",
  "mode_type": "video_subtitle_erase",
  "inputs": { "videos": [{ "url": "<video>" }] },
  "parameters": {},
  "features": {
    "subtitle_erase_v1": {
      "mode": "region",
      "regions": [
        { "x": 0.1, "y": 0.8, "width": 0.8, "height": 0.15 }
      ]
    }
  }
}
```

`mode=smart`（LibTV `Subtitle`）时可省略 `regions`。

## 5. 音频节点功能

| 画布功能 | LibTV 标识 | `mode_type` | `inputs` | `parameters` | `features` |
|---|---|---|---|---|---|
| 文生音乐 | `scene=Music` | `text2music` | `prompt`、可选上游文本 | `seconds`、`count` | 按模型声明 |
| 人声分离 | `vocal_split`（多从视频入口触发，产出音频节点） | `vocal_split` | 音频/视频 | — | `vocal_split_v1` |
| 音效生视频（空态预设） | 下游视频 `audio2video` | （文本/音频节点不 create） | 见视频 §4.1 | — | — |
| 文字转语音 | locale `textToSpeech`（若产品启用） | `text2speech` | 文本 | `speed` 等 | 按模型声明 |

TTS / 音色面板（`voice_card_v1`、语速/声调/音量、`modify_*`、音效）按模型差异见 [`libtv-audio-voice-timbre-capability.md`](./libtv-audio-voice-timbre-capability.md)。

人声分离示例：

```json
{
  "node_type": "audio",
  "mode_type": "vocal_split",
  "inputs": { "videos": [{ "url": "<source-video>" }] },
  "parameters": {},
  "features": {
    "vocal_split_v1": {
      "pick": "vocals"
    }
  }
}
```

`pick` 可由 Schema 声明：`vocals`、`background`、`sfx`。

## 6. 文本与脚本节点功能

| 画布功能 | `node_type` | `mode_type` | `inputs` | `parameters` | `features` / 说明 |
|---|---|---|---|---|---|
| 文本生成 | `text` | `text2text` | `prompt`、上游文本 | `count` | — |
| 视频解析 | `text` 或产出 `video_story` | `video_parsing` | 视频 | 按模型声明 | LibTV `aurora-3-lite` |
| 脚本生成 | `script` | `script_generate` | `prompt`、上游 text/image/video/audio | `count` 等 | LibTV `scene=script-generate` |
| 脚本重新生成 | `script` | `script_generate` | 同上 | 同上 | 本地 `regenerateCount++` |
| 分镜组生图 | `image` | `group_generate` | 脚本行 prompt / 参考图 | `ratio` 等 | `scene=group-generate` |
| 脚本提示词重算 | `script` | `script_recompute_prompts` | 脚本行 | — | `scene=script-recompute-prompts-v2` |
| 空态：自己编写 | `text` | — | — | — | 本地富文本，无 create |
| 空态：文生视频 | `text` → 下游 `video` | `text2video` | 下游提交 | — | 文本节点仅写 content |
| 空态：图反推提示词 | 上游 `image` → `text` | 反推 mode（Adapter） | 图片 | — | 文本节点写 prompt 模板 |
| 空态：文生音乐 | `text` → 下游 `audio` | `text2music` | 下游提交 | — | — |

文本上方富文本工具栏（`textTool*`，本地）：背景色、H1/H2/H3、正文、粗体、斜体、无序/有序列表、分割线、复制、展开编辑 —— **不进生成接口**。

## 7. 其他节点与素材能力

| 画布能力 | 节点 | 是否 GenerationCommand | 说明 |
|---|---|---|---|
| 视频剪辑 | `video` | 否 | AVEditor 本地 encode + 上传 |
| 音视频分离 | `video` → `audio`+静音 `video` | 否 | 本地 demux + 上传 |
| 音频截取 / 调速 | `audio` | 否 | 本地处理 + 上传 |
| 音频下载（含水印） | `audio` | 否 | 可选水印接口，非生成任务 |
| 宫格切分·建分镜组 | `image` | 否 | 本地裁切 + 建组；格内高清才 create |
| 裁剪 / 标注 / 旋转 | `image` | 否 | `Crop` / `Annotate` / `RotateOrMirror` |
| 分镜参考图上传 | `script` | 否 | 预签名上传写入 rows |
| 风格素材连线 | `material_style` → image/script | 间接 | 约束目标模型 fineTune；参数进目标 generate |
| 镜头素材连线 | `material_lens` → video | 间接 | 目标视频 `lens` 能力 |
| 参考节点 | `reference` | 间接 | 作为上游 inputs |
| 导演台 / 720 场景 | `director_console` / `space_scene_720` | 部分 | `director_img_to_scene`、`image_to_panorama` 等由 Adapter 映射 |
| 视频时间轴合成 | `video_clip` | 按产品 | 合成链路，勿与文生视频 mode 混用 |

## 8. 不进入生成接口的画布功能

以下功能是本地处理或资源操作，不应伪装成模型生成参数：

| 功能 | 处理方式 |
|---|---|
| 裁剪、标注、旋转 | 本地处理，上传结果资源 |
| 宫格切分、创建分镜组 | 本地处理和建组 |
| 视频剪辑、音频截取、调速 | 本地处理或媒体服务 |
| 音视频分离 | 本地处理或媒体服务 |
| 文本富文本编辑 | 前端本地处理 |
| 敏感词过滤 | 编辑辅助接口，非生成主链路 |

如果后续改为异步 AI 任务，再新增独立 `mode_type` 或 `feature_key`（如抠图 `matting_v1`）。

## 9. 参数命名

create、credit、节点保存共用以下业务字段：

| 语义 | 统一字段 | 旧厂商字段仅由 Adapter 处理 |
|---|---|---|
| 画质档位 | `image_quality` | `quality` |
| 分辨率 | `resolution` | `settings.quality`、`2K`、`quality` |
| 宽高比 | `ratio` | `aspect_ratio`、`settings.ratio` |
| 数量 | `count` | `n` |
| 时长 | `seconds` | 厂商 duration |
| 帧率 | `fps` | 厂商 frame rate |
| 放大倍数 | `scale` | 厂商 upscale scale |
| 慢放倍数 | `slow_motion_scale` | 视频高清 `scale` |

规则：

- 参数只在 capability 声明时提交；
- 前端提交统一业务 `scene`，不提交 `provider` 和厂商字段；
- 不用 `0`、`none` 表示“不支持”；
- `/node/credit` 与 `/task/generation/create` 请求体完全一致，只是 credit 仅返回预计积分、不创建任务；
- credit、create、节点保存从同一份参数状态和 Builder 派生。

## 10. `feature_key` 注册表（对接白名单草案）

| `feature_key` | 主要节点 | LibTV 锚点 |
|---|---|---|
| `inpaint_mask_v1` | image | Inpaint / redraw |
| `erase_mask_v1` | image | SmartRemove / erase |
| `outpaint_v1` | image | Outpaint / expand-image |
| `light_control_v1` | image | Light / light-control |
| `multi_angle_v1` | image | Angle / multiple-angles |
| `panorama_720_v1` | image | 720_panoramic* |
| `slash_preset_v1` | image | NineGridSlash |
| `image_upscale_v1` | image | Upscale / upscaler |
| `grid_cell_upscale_v1` | image | GridSplit HD |
| `style_transfer_v1` | image | StyleTransfer |
| `mockup_v1` | image | Mockup |
| `edit_elements_v1` | image | EditElements |
| `edit_texts_v1` | image | EditTexts |
| `expression_adjustment_v1` | image | expression_adjustment |
| `camera_focus_v1` | image | camera_focus |
| `scene_completion_v1` | image | scene_completion |
| `first_last_frame_v1` | video | frames2video |
| `video_upscale_v1` | video | ENHANCE / enhanceVideo |
| `subtitle_erase_v1` | video | SUBTITLE_ERASE |
| `vocal_split_v1` | audio/video | vocal_split |
| `voice_card_v1` | audio | speech-2.8-* `voiceCard` / 音色设置 |
| `regional_prompt_v1` | 按模型 | RFC 预留 |

后端只下发 `feature_key` + `config`；前端维护安全组件注册表，禁止下发组件路径。

## 11. 后端对接要求

后端需要提供：

1. 现有模型能力：`model_code`、`properties[].node_type`、`properties[].parameters[]`；
2. 参数默认值、options，以及动作能力与提交参数的明确区分；
3. 多模式上线时补充 `mode_type`；版本校验上线时补充 `schema_version`；
4. GenerationCommand 校验器；
5. LibTV/厂商 Provider Adapter（含 `/lighting`、`vocal_split`、同步抠图分流）；
6. quote 与 create 的同源计费逻辑；
7. 统一错误码和字段路径。

后端收到未声明参数时，建议返回：

```json
{
  "code": 422,
  "error": "MODEL_PARAMETER_UNKNOWN",
  "details": [
    { "path": "parameters.image_quality", "message": "当前模型不支持该参数" }
  ]
}
```

## 12. 对接验收

- [ ] 图片模型 A 声明 `image_quality`，UI 显示并提交；
- [ ] 图片模型 B 不声明 `image_quality`，UI 不显示且请求不含该字段；
- [ ] 模型切换后旧参数被清除；
- [ ] 多模式上线后，同一模型不同 `mode_type` 能返回不同参数；
- [ ] 视频十种 mode（含音频参考/驱动/编辑）均能按 schema 启停；
- [ ] 重绘、擦除、扩图、打光、多角度、Slash、高清、聚焦、表情、补全画幅进入 `features`；
- [ ] StyleTransfer / Mockup / EditElements / EditTexts 有 capability 或明确本地/未开放标记；
- [ ] quote、create、节点保存的核心参数一致；
- [ ] Adapter 能将统一字段转换成 LibTV/厂商字段；
- [ ] 裁剪、标注、剪辑、音视频分离等本地功能不误调用生成接口。

## 13. 相关文档

| 文档 | 用途 |
|---|---|
| `docs/model-capability-generation-architecture-rfc.md` | 模型能力和统一入参总架构 |
| `docs/model-param-contract.md` | 当前模型参数字段兼容约定 |
| `docs/LibTV-视频生成模式-按钮触发条件.md` | 视频模式启用条件 |
| `docs/libtv-node-connection-rules.md` | 节点连线矩阵与素材约束 |
| `docs/LibTV-*-工具栏接口参数对照表.xlsx` | LibTV 原始完整 JSON |
| `docs/LibTV-文本节点-上方工具栏功能对照.md` | 文本富文本工具栏 |
| `docs/libtv-audio-voice-timbre-capability.md` | 音频音色组件按模型能力与 parameters/features 草案 |
| `docs/LibTV-音频音色组件能力对照表.xlsx` | 音色能力中文对照表（总览 / 参数 / 映射 / 示例） |
| `docs/LibTV-图片节点-模型生成能力对照表.xlsx` | 图片模型按 tool_spec 的 parameters/features + create.v1 |
| `docs/LibTV-视频节点-模型生成能力对照表.xlsx` | 视频模型按 tool_spec 的 parameters/features + create.v1 |
| `docs/LibTV-文本节点-模型生成能力对照表.xlsx` | 文本模型按 tool_spec 的 parameters/features + create.v1 |
| `docs/LibTV-脚本节点-模型生成能力对照表.xlsx` | 脚本模型（复用 text tool_spec）+ `script_generate` create.v1 |

## 14. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-07-22 | 新增 `LibTV-脚本节点-模型生成能力对照表.xlsx`（复用 text tool_spec ×7，scene=`script-generate`） |
| 2026-07-20 | 按 RFC 结构整理对接引导 |
| 2026-07-20 | **全量抓取更新**：已登录 LibTV 画布 chunk，补齐 `ElementTool` 16 项、视频 modeType 文案、新增 scene（`camera_focus` / `expression_adjustment` / `scene_completion` 等）、节点类型与 `feature_key` 白名单 |
