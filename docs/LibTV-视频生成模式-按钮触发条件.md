# LibTV 视频生成模式 · 按钮触发条件逆向

> **证据来源**  
> 1. LibTV 线上 canvas HTML / locale（`www.liblib.tv/canvas` 内嵌 i18n：`modeType*`、`generateButton*`、禁用 tip）  
> 2. Seedance 2.0 公开能力说明（多模态参考上限：图 ≤9、视频 ≤3、音频 ≤3；文生 / 图生(首帧) / 首尾帧 / 全能参考 / 视频编辑）  
> 3. AImanju 现有视频节点实现对照（`VIDEO_GENERATION_MODE_OPTIONS`、连线 `relation`）  
>  
> **局限**：模式启用的具体 `min/max` 数字由**当前模型懒加载 schema** 下发；该逻辑不在 canvas 首包 JS 中，登录后 chunk 未完整抓取。下文对区间标注 **〔硬证据〕** / **〔强推断〕** / **〔开放〕**。  
>  
> 生成日期：2026-07-15

---

## 1. 结论摘要

- 图2「视频生成模式」下拉（以及图1顶部 Tab）是同一组模式切换：  
  **文生视频 → 全能参考 → 图生视频 → 首尾帧 → 图片参考**。
- 可用性 = **模型声明支持该 modeType** ∧ **当前节点已连接媒体组合满足该模式约束**。
- 灰显不是写死 UI，而是运行时算出 `disabled` + tip（locale 有完整错误句模板）。
- AImanju 目前在 `components/flow/video/constants/generation.ts` **静态写死** `disabled`，尚未接 LibTV 这套动态判定。

| UI 文案 | LibTV modeType | AImanju mode | 典型启用条件（摘要） |
|---------|----------------|--------------|----------------------|
| 文生视频 | `text2video` | `textToVideo` | 无图/视/音；模型支持文生 |
| 全能参考 | `mixed2video` | `omniRef` | 模型支持混合输入；图/视/音均在上限内 |
| 图生视频 | `singleImage2video` | `imageToVideo` | 通常 **恰好 1 张图**，一般无视频 |
| 首尾帧 | `frames2video` | `framePair` | 通常 **恰好 2 张图**（首帧+尾帧） |
| 图片参考 | `image2video` | `imageRef` | **多图参考**区间（可 >1），与单图模式区分 |

---

## 2. UI 与内部 ID 对照

### 2.1 图2菜单五项（主路径）

| 顺序 | 文案 | i18n `modeType*` | i18n `generateButton*` | 推定 API / 内部 id |
|------|------|------------------|------------------------|---------------------|
| 1 | 文生视频 | `modeTypeText2video` | `generateButtonVideo2` | `text2video` |
| 2 | 全能参考 | `modeTypeMixed2video` | `generateButtonText81e526` | `mixed2video` |
| 3 | 图生视频 | `modeTypeSingleImage2video` | `generateButtonVideo` | `singleImage2video` |
| 4 | 首尾帧 | `modeTypeFrames2video` | `generateButtonText9c75f7` | `frames2video` |
| 5 | 图片参考 | `modeTypeImage2video` | `generateButtonImage` | `image2video` |

### 2.2 同文件扩展模式（不一定进五钮条）

| 文案 | modeType | 说明 |
|------|----------|------|
| 首帧 | `modeTypeFirstFrame` | 仅首帧生视频（窄于首尾帧） |
| 视频参考 | `modeTypeVideo2video` / `generateButtonVideo3` | 以视频为参考 |
| 音频参考 | `modeTypeAudio2video` / `generateButtonAudio` | 以音频为参考 |
| 音频驱动 | `modeTypeAudio2videoDrive` | 音频驱动变体 |
| 视频编辑 | `modeTypeVideoEdit2video` / `generateButtonEditVideo` | 对已有视频编辑/延展 |

菜单标题：`videoGenerateModeTitle` =「视频生成模式」。

---

## 3. 启用判定流水线〔硬证据结构 + 强推断实现〕

```text
输入：
  - model.supportedModeTypes（或等价字段）
  - model.mediaLimits / 每模式 range（懒加载 schema）
  - 当前视频节点已连接：imageCount / videoCount / audioCount
  - （首尾帧）可选：首帧位 / 尾帧位是否已分配

步骤：
  1) 若 mode ∉ 模型支持列表 → disabled
     tip 例：noText2videoUploadImage / modeTypeUnsupportedMediaCombo / videoModelRequiresMedia

  2) 否则按该模式的媒体区间校验：
     - count == 0 且模式要求 >0 → modeTypeNeedConnectMedia
     - count 不在 [min,max] → modeTypeMediaCountMismatch
     - 超过全局上限 → Image/Video/AudioMaxExceeded
     - 有视频时图片上限更严 → ImageMaxWithVideoExceeded

  3) 文生特例：任一媒体 >0 → modeTypeText2videoMediaConnected

  4) 切换到某些模式时可能忽略部分已连接输入 → modeTypeIgnoreConnectedMedia
```

伪代码（对齐产品行为，便于 AImanju 落地）：

```ts
type MediaCounts = { image: number, video: number, audio: number }

type ModeRule = {
  id: 'text2video' | 'mixed2video' | 'singleImage2video' | 'frames2video' | 'image2video'
  /** 模型是否声明支持 */
  supportedByModel: boolean
  /** 各媒体允许区间；null 表示该维度必须为 0 */
  image?: [number, number] | null
  video?: [number, number] | null
  audio?: [number, number] | null
}

function isModeEnabled(rule: ModeRule, c: MediaCounts): { ok: boolean, tipKey?: string } {
  if (!rule.supportedByModel)
    return { ok: false, tipKey: 'modeTypeUnsupportedMediaCombo' }

  if (rule.id === 'text2video') {
    if (c.image + c.video + c.audio > 0)
      return { ok: false, tipKey: 'modeTypeText2videoMediaConnected' }
    return { ok: true }
  }

  for (const [kind, range] of [
    ['image', rule.image],
    ['video', rule.video],
    ['audio', rule.audio],
  ] as const) {
    const count = c[kind]
    if (range == null) {
      if (count > 0) return { ok: false, tipKey: 'modeTypeUnsupportedMediaCombo' }
      continue
    }
    const [min, max] = range
    if (count < min) return { ok: false, tipKey: 'modeTypeNeedConnectMedia' }
    if (count > max) return { ok: false, tipKey: 'modeTypeMediaCountMismatch' }
  }
  return { ok: true }
}
```

---

## 4. 五个按钮的触发条件（逐项）

### 4.1 文生视频 · `text2video`

| 项 | 内容 | 确信度 |
|----|------|--------|
| **开启** | 模型支持文生；且 `image=0 ∧ video=0 ∧ audio=0` | 硬证据（`modeTypeText2videoMediaConnected`） |
| **关闭 tip** | 「已连接媒体输入，无法使用纯文生视频」 | 硬证据 |
| **模型不支持** | 「该模型不支持文生视频，请上传参考图片」`noText2videoUploadImage` | 硬证据 |
| **产品语义** | 纯提示词出片；Seedance 文档「Text to video」 | 旁证 |

### 4.2 全能参考 · `mixed2video`

| 项 | 内容 | 确信度 |
|----|------|--------|
| **开启** | 模型支持 `mixed2video`；图/视/音数量均不超过混合上限 | 硬证据（上限 tip 齐全）+ 强推断 |
| **典型上限** | 图 ≤9、视频 ≤3、音频 ≤3（Seedance 2.0 公开值；LibTV 以模型 schema 为准） | 旁证 / 开放（schema） |
| **含视频时** | 视频时长上限 tip：`mixedVideoMaxDuration10`（最长约 10s） | 硬证据 |
| **有视频时图片** | 可能使用更低图片上限：`modeTypeImageMaxWithVideoExceeded` | 硬证据 |
| **主体** | 传入视频时不可用视频主体：`videoSubjectDisabledWithVideo` | 硬证据 |
| **产品语义** | 多模态参考（图+视+音+文）；分镜批量生视频亦强调仅 `mixed2video` | 硬证据（`storyboardVideoRefUnsupportedByModel`） |
| **UI** | 图1/图2 常作默认选中 | 观测 |

### 4.3 图生视频 · `singleImage2video`

| 项 | 内容 | 确信度 |
|----|------|--------|
| **开启** | 模型支持；图片数落入单图区间（产品上 **通常恰好 1**）；一般要求视频=0 | 强推断（命名 `SingleImage` + NeedConnect/Mismatch tip） |
| **关闭** | 0 张 / ≥2 张 / 带视频 → `NeedConnectMedia` 或 `MediaCountMismatch` | 强推断 |
| **产品语义** | 单图驱动运动；Seedance「Image to video」里「作为 first frame」的窄用法 | 旁证 |
| **与「图片参考」区别** | 图生视频 = 单图主输入；图片参考 = 多图参考列表 | 强推断 |

### 4.4 首尾帧 · `frames2video`

| 项 | 内容 | 确信度 |
|----|------|--------|
| **开启** | 模型支持；图片数对应首+尾（产品上 **通常恰好 2**），并可落到首帧/尾帧角色位 | 强推断 |
| **相关变体** | `modeTypeFirstFrame` 仅首帧；`loopMode` 用同一图作首尾循环 | 硬证据（文案） |
| **连线语义** | AImanju / LibTV 协议侧存在 `first_frame_image` / `last_frame_image` | AImanju 硬证据 |
| **关闭** | 图片数 ≠ 2 或未配齐首尾角色 | 强推断 |

### 4.5 图片参考 · `image2video`

| 项 | 内容 | 确信度 |
|----|------|--------|
| **开启** | 模型支持多图参考；图片数在多参 `[min,max]`（常见 `min≥1` 且允许 `>1`） | 强推断 |
| **图2观测** | 「图片参考」白字可点、「图生/首尾」灰 → 有图但不满足单图/双帧精确条件 | 观测 |
| **拖入参考** | 仅支持拖入图/视/音；达上限 / 模型不支持有独立 tip（`refDrop*`） | 硬证据 |

---

## 5. 用图2状态反推画布媒体

图2下拉观测：

| 按钮 | 视觉 | 推断 |
|------|------|------|
| 文生视频 | 灰 | 已连接任意媒体 |
| 全能参考 | 高亮选中/hover | 模型支持 mixed，且组合合法 |
| 图生视频 | 灰 | 图片数 ≠ 单图要求 |
| 首尾帧 | 灰 | 图片数 ≠ 双帧要求（或未成首尾位） |
| 图片参考 | 白色可点 | 图片数落在「多图参考」区间 |

**较可能的现场**：≥3 张参考图，或「多图 +（可选）音/视频」；**不是**「刚好 1 张」也不是「刚好首尾 2 张」。

---

## 6. 禁用 / 提示文案全集（locale 硬证据）

| Key | 文案 |
|-----|------|
| `modeTypeText2videoMediaConnected` | 已连接媒体输入，无法使用纯文生视频 |
| `modeTypeNeedConnectMedia` | 需要连接{mediaLabel}节点（{rangeText}个） |
| `modeTypeMediaCountMismatch` | 当前{mediaLabel}数量 {count} 个，需要 {rangeText} 个 |
| `modeTypeUnsupportedMediaCombo` | 当前模型不支持已连接的媒体组合 |
| `modeTypeImageMaxExceeded` | 图片最多 {max} 个，当前 {count} 个 |
| `modeTypeVideoMaxExceeded` | 视频最多 {max} 个，当前 {count} 个 |
| `modeTypeAudioMaxExceeded` | 音频最多 {max} 个，当前 {count} 个 |
| `modeTypeImageMaxWithVideoExceeded` | 有视频时，图片最多 {max} 个，当前 {count} 个 |
| `modeTypeIgnoreConnectedMedia` | 该模式将忽略已连接的{labels}输入 |
| `noText2videoUploadImage` | 该模型不支持文生视频，请上传参考图片 |
| `videoModelRequiresMedia` | 该模型需要连入图片或视频素材 |
| `needRefImageForVideo` | 该模型需要参考图片才能生成视频 |
| `needImageAndVideo` | 该模型需要连入图片和视频素材 |
| `mixedVideoMaxDuration10` | 全能参考包含视频时视频时长最长10s |
| `videoSubjectDisabledWithVideo` | 传入视频时不可使用视频主体 |
| `videoSubjectAutoRemoved` | 当前模式不可使用视频主体，已自动移除 |
| `videoCameraPresetDeferredTooltip` | 当前模式不支持预设运镜 |
| `addRefImageAndVideo` | 请同时添加参考图片和视频 |
| `addRefImageAndAudio` | 请同时添加参考图片和音频 |
| `refDropTypeUnsupported` | 仅支持将图片、视频、音频拖入参考 |
| `refDropLimitReached` | 参考数量已达上限 |
| `refDropModelUnsupported` | 当前模型不支持该素材作为参考 |

媒体标签：`mediaLabelImage` / `Video` / `Audio` / `ImageVideo`。

规则拼接：`ruleModeTypeInMode`（「{modeType}模式下，」）+ `ruleWhenHasPrefix`（「添加{items}时，需同时」）等，用于生成器旁动态说明。

---

## 7. 与 Seedance 2.0 能力的对齐（旁证）

公开说明（非 LibTV 源码，但与 `mixed2video` 语义一致）：

| 能力 | 公开描述 | 对应 LibTV 模式 |
|------|----------|-----------------|
| Text to video | 纯文案 | 文生视频 |
| Image to video | 静图作首帧；可再指定尾帧 | 图生视频 / 首尾帧 |
| Multimodal reference | 最多约 9 图 + 3 视频 + 3 音频 | 全能参考 / 图片参考 |
| Video editing / extension | 参考视频改写或续写 | 视频编辑 / 视频参考 |

LibTV UI 把「单图驱动」「双帧」「多图参考」「混合模态」拆成不同按钮，避免一个模式塞所有交互。

---

## 8. AImanju 现状对照

| 项 | 路径 / 行为 | 与 LibTV 差距 |
|----|-------------|---------------|
| 模式枚举 | `types/flow-nodes/video-data.ts` → `VideoGenerationMode` | 五档命名已对齐（语义层） |
| Tab 配置 | `components/flow/video/constants/generation.ts` | **静态** `disabled`：文生/首尾/图片参考恒灰；全能/图生恒亮 |
| UI | `VideoSelectedPanel.vue` 顶部五格 Tab | 无 tip、不随连线变化 |
| 持久化 | `utils/flow/videoNodeExtraData.ts` `mapVideoModeToModeType` | 目前粗映射为 `text2image` / `image2image`，**未写** `text2video`/`mixed2video` 等 |
| 连线角色 | `flowConnectionPolicy`：`first_frame_image` / `last_frame_image` / `reference_*` | 结构上可支撑首尾帧与参考，但未驱动模式按钮 |

### 建议落地顺序

1. 按连接边统计 `imageCount / videoCount / audioCount`（及首尾帧 relation）。  
2. 从 `/node/models`（或节点上模型能力）读取每模式 `supported` + `[min,max]`。  
3. 替换 `VIDEO_GENERATION_MODE_OPTIONS` 的静态 `disabled` 为计算属性；tip 复用上表 key 文案。  
4. batch / create 的 `modeType` 与 LibTV 字符串对齐（`text2video` / `mixed2video` / …）。

---

## 9. 图1 vs 图2

| | 图1 | 图2 |
|--|-----|-----|
| 形态 | 顶部横向 Segmented Tab | 下拉「视频生成模式」列表（图标+文案） |
| 选项集合 | 相同五钮 | 相同五钮 |
| 选中态 | 「全能参考」紫底 | 「全能参考」行高亮 |
| 禁用态 | 灰字 | 灰字/弱图标；「图片参考」可点 |

二者共用同一套启用逻辑，仅容器不同。

---

## 10. 仍待深挖（开放项）

1. **模型 schema 字段名与精确 min/max**  
   需登录后抓懒加载 chunk，或抓 `/node/models`（及模型详情）响应中 `supportedModes` / `mediaLimits` 一类字段。  
2. **首尾帧是否强制端口角色**  
   仅「2 张图」是否足够，还是必须分别占用 `first_frame` / `last_frame`。  
3. **忽略媒体**  
   `modeTypeIgnoreConnectedMedia` 在哪些模式切换时触发、忽略哪些 `labels`。  
4. **AImanju ↔ LibTV modeType 落库字符串**  
   当前 `videoNodeExtraData` 粗映射是否导致对账失败，需对着真实 create 请求核对。

---

## 11. 附录 · 相关 locale 索引

```
modeTypeText2video / SingleImage2video / Frames2video / FirstFrame
modeTypeImage2video / Video2video / VideoEdit2video / Audio2video / Mixed2video
generateButtonVideo2 / Text81e526 / Video / Text9c75f7 / Image / Video3 / Audio / EditVideo
videoGenerateModeTitle
mediaLabelImage | Video | Audio | ImageVideo
```

完整 tip 见 §6。

---

## 12. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-15 | 初版：基于 canvas locale + Seedance 旁证 + AImanju 对照；标出硬证据 / 强推断 / 开放项 |
