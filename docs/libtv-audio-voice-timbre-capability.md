# LibTV 音频音色组件能力对照

> 用途：按模型说明「音色 / 基础调节 / 音色效果」有哪些字段，并给出本项目 `/api/node/models` 能力声明草案。  
> 证据：`GET https://api.liblib.tv/api/tool_spec/list`（2026-07-21 公开抓取）中 `type: "audio"` 条目的 `metadata.properties` + `metadata.config.advancedSettings`。  
> 架构基准：[`model-capability-generation-architecture-rfc.md`](./model-capability-generation-architecture-rfc.md)、[`libtv-model-node-feature-params.md`](./libtv-model-node-feature-params.md)

## 1. 结论速览

| LibTV `toolKey` / `modelKey` | 展示名 | scene | 音色卡片 | 基础调节（语速/声调/音量） | 音色效果（音高/强度/音色调节/音效） | 其它高级项 |
|---|---|---|---|---|---|---|
| `speech-2.8-hd` | Minimax-speech-2.8-hd | Text-to-Speech | ✅ `voiceCard` | ✅ | ✅ | — |
| `speech-2.8-turbo` | Minimax-speech-2.8-turbo | Text-to-Speech | ✅ `voiceCard` | ✅ | ✅ | — |
| `seed-audio-1.0` | seed-audio-1.0 | （空） | ❌ | ✅（字段名 `pitch`，不是 `voicePitch`） | ❌ | 语种 / 采样率 / 输出格式 |
| `vocal-v3` | 智能语音模型V3 / Eleven V3 | Text-to-Speech | ❌（`singleSelect` 音色） | ❌ | ❌ | `voice`、`stability` |
| `vocal-music` | 智能音乐模型 | Music | ❌ | ❌ | ❌ | `duration` |
| `mureka-8` / `mureka-9` | Mureka V8 / V9 | Music | ❌ | ❌ | ❌ | `instrumental` 纯乐器 |
| `minimax-voice-design` | MiniMax voice design | Voice-Design | ❌ | ❌ | ❌ | 仅 prompt |

**与截图一致的「音色设置 + 基础调节 + 音色效果调节」三栏 UI，只属于 MiniMax `speech-2.8-hd` / `speech-2.8-turbo`。**  
其它模型不要前端按 `model_code` 特判；由 capability 是否声明对应 `parameters` / `features` 决定显隐。

## 2. LibTV 原始分组（speech-2.8-*）

```json
"advancedSettings": [
  {
    "groupKey": "voiceCard",
    "displayName": "音色设置",
    "collapsible": false,
    "fields": ["voiceCard"]
  },
  {
    "groupKey": "voiceBasic",
    "displayName": "基础调节",
    "collapsible": true,
    "defaultCollapsed": false,
    "fields": ["speed", "voicePitch", "vol"]
  },
  {
    "groupKey": "voiceEffects",
    "displayName": "音色效果调节",
    "collapsible": true,
    "defaultCollapsed": true,
    "fields": ["modifyPitch", "modifyIntensity", "modifyTimbre", "soundEffects"]
  }
]
```

| UI | LibTV schema key | LibTV `originalField`（厂商提交名） | component | 范围 / 默认 |
|---|---|---|---|---|
| 音色设置 | `voiceCard` | `voice_setting_voice_id` | `voiceCard` | 默认对象含 `voiceId: female-shaonv`（少女音色） |
| 语速 | `speed` | `voice_setting_speed` | slider | 0.5–2 / step 0.01 / default 1 |
| 声调 | `voicePitch` | `voice_setting_pitch` | slider | -12–12 / step 1 / default 0 |
| 音量 | `vol` | `voice_setting_vol` | slider | 0.01–10 / step 0.1 / default 1 |
| 音高 | `modifyPitch` | `voice_modify_pitch` | slider | -100–100 / step 1 / default 0；tips「音高调整（低沉/明亮）」 |
| 强度 | `modifyIntensity` | `voice_modify_intensity` | slider | -100–100 / step 1 / default 0；tips「强度调整（力量感/柔和）」 |
| 音色调节 | `modifyTimbre` | `voice_modify_timbre` | slider | -100–100 / step 1 / default 0；tips「音色调整（磁性/清脆）」 |
| 音效 | `soundEffects` | `voice_modify_sound_effects` | singleButton | LibTV 默认 `""`；枚举见下 |

音效枚举（LibTV）：

| displayName | value |
|---|---|
| 无 | `""` |
| 空旷回音 | `spacious_echo` |
| 礼堂广播 | `auditorium_echo` |
| 电话失真 | `lofi_telephone` |
| 电音 | `robotic` |

> 本项目协议建议用 `"none"` 代替空字符串表示「无」，由后端 Adapter 映射为厂商 `""` / 省略。

## 3. 本项目能力声明格式（按模型）

约定：

- `parameters[]`：只放标量（`string | number | boolean`）；
- 音色卡片（对象 + 选音色面板）进 `features.voice_card_v1`；
- `key` 用业务名；LibTV `originalField` 仅后端 Adapter 使用；
- `ui_group`：`voice_basic` / `voice_effects` 对齐 LibTV 分组文案。

### 3.1 `speech-2.8-hd` / `speech-2.8-turbo`（完整音色面板）

两模型 schema **完全一致**。`model_code` 分别用 `speech-2.8-hd`、`speech-2.8-turbo`。

```json
{
  "model_code": "speech-2.8-hd",
  "model_name": "Minimax-speech-2.8-hd",
  "properties": [
    {
      "node_type": "audio",
      "mode_type": "text2audio",
      "schema_version": 1,
      "parameters": [
        {
          "key": "speed",
          "tips": "语速",
          "kind": "parameter",
          "submit": true,
          "value_type": "number",
          "default": 1,
          "min": 0.5,
          "max": 2,
          "step": 0.01,
          "ui_hint": "slider",
          "ui_group": "voice_basic"
        },
        {
          "key": "pitch",
          "tips": "声调",
          "kind": "parameter",
          "submit": true,
          "value_type": "integer",
          "default": 0,
          "min": -12,
          "max": 12,
          "step": 1,
          "ui_hint": "slider",
          "ui_group": "voice_basic"
        },
        {
          "key": "volume",
          "tips": "音量",
          "kind": "parameter",
          "submit": true,
          "value_type": "number",
          "default": 1,
          "min": 0.01,
          "max": 10,
          "step": 0.1,
          "ui_hint": "slider",
          "ui_group": "voice_basic"
        },
        {
          "key": "modify_pitch",
          "tips": "音高",
          "kind": "parameter",
          "submit": true,
          "value_type": "integer",
          "default": 0,
          "min": -100,
          "max": 100,
          "step": 1,
          "ui_hint": "slider",
          "ui_group": "voice_effects",
          "help": "音高调整（低沉/明亮）"
        },
        {
          "key": "modify_intensity",
          "tips": "强度",
          "kind": "parameter",
          "submit": true,
          "value_type": "integer",
          "default": 0,
          "min": -100,
          "max": 100,
          "step": 1,
          "ui_hint": "slider",
          "ui_group": "voice_effects",
          "help": "强度调整（力量感/柔和）"
        },
        {
          "key": "modify_timbre",
          "tips": "音色调节",
          "kind": "parameter",
          "submit": true,
          "value_type": "integer",
          "default": 0,
          "min": -100,
          "max": 100,
          "step": 1,
          "ui_hint": "slider",
          "ui_group": "voice_effects",
          "help": "音色调整（磁性/清脆）"
        },
        {
          "key": "sound_effects",
          "tips": "音效",
          "kind": "parameter",
          "submit": true,
          "value_type": "string",
          "default": "none",
          "ui_hint": "single_button",
          "ui_group": "voice_effects",
          "options": [
            { "label": "无", "value": "none" },
            { "label": "空旷回音", "value": "spacious_echo" },
            { "label": "礼堂广播", "value": "auditorium_echo" },
            { "label": "电话失真", "value": "lofi_telephone" },
            { "label": "电音", "value": "robotic" }
          ]
        }
      ],
      "features": [
        {
          "feature_key": "voice_card_v1",
          "tips": "音色设置",
          "required": true
        }
      ]
    }
  ]
}
```

`speech-2.8-turbo`：同上，仅改 `model_code` / `model_name`。

默认音色卡片（LibTV，仅本地展示参考；create 建议只提交 `voice_id`）：

```json
{
  "voiceId": "female-shaonv",
  "name": "少女音色",
  "language": "中文(普通话)",
  "gender": "Female",
  "voiceUrl": "https://libtv-res.liblib.art/sd-gen-save-img/genius_playground/audio/.../....mp3"
}
```

### 3.2 `seed-audio-1.0`（仅基础调节 + 输出设置）

无 `voiceCard` / `modify_*` / `soundEffects`。基础三滑条字段名在 LibTV 为 `speed` / `pitch` / `vol`。

```json
{
  "model_code": "seed-audio-1.0",
  "model_name": "seed-audio-1.0",
  "properties": [
    {
      "node_type": "audio",
      "mode_type": "text2audio",
      "schema_version": 1,
      "parameters": [
        {
          "key": "speed",
          "tips": "语速",
          "kind": "parameter",
          "submit": true,
          "value_type": "number",
          "default": 1,
          "min": 0.5,
          "max": 2,
          "step": 0.01,
          "ui_hint": "slider",
          "ui_group": "voice_basic"
        },
        {
          "key": "pitch",
          "tips": "声调",
          "kind": "parameter",
          "submit": true,
          "value_type": "integer",
          "default": 0,
          "min": -12,
          "max": 12,
          "step": 1,
          "ui_hint": "slider",
          "ui_group": "voice_basic"
        },
        {
          "key": "volume",
          "tips": "音量",
          "kind": "parameter",
          "submit": true,
          "value_type": "number",
          "default": 1,
          "min": 0.01,
          "max": 10,
          "step": 0.1,
          "ui_hint": "slider",
          "ui_group": "voice_basic"
        },
        {
          "key": "language",
          "tips": "语种",
          "kind": "parameter",
          "submit": true,
          "value_type": "string",
          "default": "zh",
          "ui_hint": "single_button",
          "ui_group": "audio_output",
          "options": [
            { "label": "中文", "value": "zh" },
            { "label": "英文", "value": "en" }
          ]
        },
        {
          "key": "sample_rate",
          "tips": "采样率",
          "kind": "parameter",
          "submit": true,
          "value_type": "integer",
          "default": 24000,
          "ui_hint": "single_button",
          "ui_group": "audio_output",
          "options": [
            { "label": "8k", "value": 8000 },
            { "label": "16k", "value": 16000 },
            { "label": "24k", "value": 24000 },
            { "label": "48k", "value": 48000 }
          ]
        },
        {
          "key": "format",
          "tips": "输出格式",
          "kind": "parameter",
          "submit": true,
          "value_type": "string",
          "default": "wav",
          "ui_hint": "single_button",
          "ui_group": "audio_output",
          "options": [
            { "label": "wav", "value": "wav" },
            { "label": "mp3", "value": "mp3" },
            { "label": "pcm", "value": "pcm" },
            { "label": "ogg_opus", "value": "ogg_opus" }
          ]
        }
      ],
      "features": []
    }
  ]
}
```

LibTV 还声明 `modeType` 支持 `text2audio` / `image2audio` / `audio2audio`（参考音频）；若产品要做多模式，再拆 `mode_type` 多份 capability。

### 3.3 `vocal-v3`（另一套面板，非 Minimax 音色效果）

```json
{
  "model_code": "vocal-v3",
  "model_name": "智能语音模型V3",
  "properties": [
    {
      "node_type": "audio",
      "mode_type": "text2audio",
      "schema_version": 1,
      "parameters": [
        {
          "key": "voice_id",
          "tips": "音色",
          "kind": "parameter",
          "submit": true,
          "value_type": "string",
          "ui_hint": "single_select",
          "ui_group": "voice_basic"
        },
        {
          "key": "stability",
          "tips": "稳定性",
          "kind": "parameter",
          "submit": true,
          "value_type": "number",
          "default": 0.5,
          "ui_hint": "single_button",
          "ui_group": "voice_basic",
          "options": [
            { "label": "活泼的", "value": 0 },
            { "label": "自然的", "value": 0.5 },
            { "label": "沉稳的", "value": 1 }
          ]
        }
      ],
      "features": []
    }
  ]
}
```

说明：LibTV `voice` 为 `singleSelect` + `originalField: voice_id`，选项列表由音色接口动态下发，不在 `tool_spec` 写死。若 UI 升级为卡片选择器，可改为 `features.voice_card_v1`。

### 3.4 音乐类（非「音色效果」组件，附带对照）

| model_code | 能力要点 |
|---|---|
| `vocal-music` | `duration`（`music_length_ms`）：30s / 1–4 分钟 |
| `mureka-8` / `mureka-9` | `instrumental`（`force_instrumental`）纯乐器开关；V8 另有 `text2audio` / `lyrics2audio` 模式 |
| `minimax-voice-design` | 仅 prompt，无高级参数 |

## 4. create 示例（speech-2.8-hd）

```json
{
  "node_type": "audio",
  "task_type": "audio",
  "model_code": "speech-2.8-hd",
  "scene": "text_to_audio",
  "inputs": {
    "prompt": "要合成的文本",
    "images": [],
    "videos": [],
    "audios": [],
    "texts": []
  },
  "parameters": {
    "speed": 1,
    "pitch": 0,
    "volume": 1,
    "modify_pitch": 0,
    "modify_intensity": 0,
    "modify_timbre": 0,
    "sound_effects": "spacious_echo"
  },
  "features": {
    "voice_card_v1": {
      "voice_id": "female-shaonv"
    }
  }
}
```

选「无」音效：省略 `sound_effects`，或传 `"none"`（前后端择一并写死）。

## 5. 业务字段 → LibTV / MiniMax Adapter

| 本项目 `parameters` / `features` | LibTV `originalField` / 厂商 |
|---|---|
| `speed` | `voice_setting_speed` |
| `pitch` | `voice_setting_pitch` |
| `volume` | `voice_setting_vol` |
| `modify_pitch` | `voice_modify_pitch` |
| `modify_intensity` | `voice_modify_intensity` |
| `modify_timbre` | `voice_modify_timbre` |
| `sound_effects`（`"none"` → `""`） | `voice_modify_sound_effects` |
| `features.voice_card_v1.voice_id` | `voice_setting_voice_id` |
| `language` | `language` |
| `sample_rate` | `sample_rate` |
| `format` | `format` |
| `stability` | （LibTV 未给 originalField，按厂商 Adapter） |
| `voice_id`（vocal-v3） | `voice_id` |
| `instrumental` | `force_instrumental` |
| `duration`（ms） | `music_length_ms` |

## 6. 前端落地注意

1. **禁止** `if (modelCode === 'speech-2.8-hd')` 决定是否显示「音色效果」；只看当前 capability 是否声明 `modify_pitch` 等。
2. 切换模型时：不支持的 `parameters` / `features` 立即清除；必填 `voice_card_v1` 未选则拦生成。
3. 当前仓库 `TimbreBasicAdjustPanel` / `TimbreEffectPanel` 仍是写死滑条；应以本文件 schema 驱动，并与 quote / create / 节点保存同源。
4. `feature_key` 白名单需登记 `voice_card_v1`（见 `libtv-model-node-feature-params.md` §10）。

## 7. 相关文档

| 文档 | 用途 |
|---|---|
| `docs/model-capability-generation-architecture-rfc.md` | 能力驱动 UI 与统一入参 |
| `docs/libtv-model-node-feature-params.md` | 全节点功能与 feature_key |
| `docs/LibTV-音频音色组件能力对照表.xlsx` | **推荐**：按模型总览 / 参数明细 / 字段映射 / create 示例（中文表） |
| `docs/LibTV-音频节点-工具栏接口参数对照表.xlsx` | 裁剪 / 调速 / 下载等工具栏（非音色面板） |

## 8. 修订记录

| 日期 | 说明 |
|---|---|
| 2026-07-21 | 基于公开 `tool_spec/list` 抓取，整理各 audio 模型音色能力与本项目 parameters/features 草案 |
