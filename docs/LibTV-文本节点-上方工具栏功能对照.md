# LibTV 文本节点 · 上方工具栏功能对照

> 逆向证据：LibTV 线上 locale（`www.liblib.tv/canvas` HTML/RSC）中的 `textTool*` / `textAction*` 键值。  
> 画布实现 chunk 需登录懒加载；功能集合以 i18n + 产品结构推定，并与 AImanju `TextCustomToolbar` 对照。  
> 生成日期：2026-07-15

---

## 1. 结论摘要

- **定位**：仅在「自定义编写 / 富文本编辑」态出现的上方工具栏，用于**本地排版与内容操作**，不是模型生成工具，**无 AI HTTP 接口**。
- **功能集合**：背景色｜H1/H2/H3｜正文｜粗体｜斜体｜无序列表｜有序列表｜分割线｜复制内容｜展开编辑。
- **明确缺失于 LibTV 工具栏文案**：无 `textToolDownload`；下载更可能走批量下载 / 右键菜单（空内容提示 `noContentToDownload`）。
- **与 AImanju 主要差异**：
  1. AImanju 工具栏多了「下载」；
  2. 空态快捷多了「导入剧集」；
  3. 个别中文标签用词略不同（如「粗体」vs 习惯说法「加粗」、「自己编写内容」vs「自定义内容」）。

---

## 2. 上方工具栏总览（`textTool*`）

| 顺序 | LibTV i18n Key | LibTV 文案 | 功能说明 | 交互 / 实现要点 | AImanju 现状 | 对齐状态 |
|------|----------------|------------|----------|-----------------|--------------|----------|
| 1 | `textToolBackgroundColor` | 背景色 | 设置编辑区域背景色（非文字高亮） | 下拉色板；可选「无背景」；本地样式 | `TextCustomToolbar` 色板 + `applyBackgroundColor` | 已对齐 |
| 2 | `textToolHeading` | 标题 `{level}` | 标题样式 H1/H2/H3 | tooltip 带 level；通常 3 个独立按钮 | `h1/h2/h3` → `formatHeading(1\|2\|3)` / Tiptap `setHeading` | 已对齐 |
| 3 | `textToolParagraph` | 正文 | 切回普通段落 | 取消标题 / 列表块级样式 | `setParagraph` → `paragraph` | 已对齐 |
| 4 | `textToolBold` | 粗体 | 行内加粗 | 切换 mark `bold` | `toggleInlineMark('bold')` | 已对齐 |
| 5 | `textToolItalic` | 斜体 | 行内斜体 | 切换 mark `italic` | `toggleInlineMark('italic')` | 已对齐 |
| 6 | `textToolBulletList` | 无序列表 | 无序项目符号列表 | 列表切换；再点可取消 | `toggleList('bulleted-list')` | 已对齐 |
| 7 | `textToolOrderedList` | 有序列表 | 有序数字列表 | 列表切换；再点可取消 | `toggleList('numbered-list')` | 已对齐 |
| 8 | `textToolDivider` | 分割线 | 插入水平分割线 | 插入 `divider` 块 | `insertDivider` | 已对齐 |
| 9 | `textToolCopy` | 复制内容 | 复制正文纯文本到剪贴板 | 成功 toast：`copiedToClipboard`「已复制到剪贴板」 | `copyContent` → `clipboard.writeText(innerText)` | 已对齐 |
| 10 | `textToolExpand` | 展开编辑 | 全屏 / 放大编辑 | 进入展开编辑会话 | `toggleExpand` / `isEditorFullscreen` | 已对齐 |
| 11 | —（无 `textToolDownload`） | （工具栏未见独立下载文案） | 上方工具栏未挂载专用下载 Key | 相关：`noContentToDownload`「暂无内容可下载」；批量下载含「文字」 | 工具栏有 download → `downloadContent(.txt)` | **超出 LibTV**（AImanju 多了下载） |

编辑器占位文案：`textEditorPlaceholder` →「输入内容…」

---

## 3. 空态快捷操作（`textAction*`，非上方工具栏）

空文本节点选中时，下方建议区提供快捷入口（进入编辑或拉预设连线组），**不是**上方富文本工具栏。

| LibTV i18n Key | LibTV 文案 | 功能说明 | AImanju key / 文案 | AImanju 行为 | 对齐状态 |
|----------------|------------|----------|-------------------|--------------|----------|
| `textActionWriteContent` | 自己编写内容 | 进入自定义编写 / 富文本编辑会话 | `customContent` / 自定义内容 | `openCustomEditor` | 文案略异，行为对齐 |
| `textActionTextToVideo` | 文生视频 | 创建文→视频预设连线组 | `textToVideo` / 文生视频 | `runTextToVideoGroupPreset` | 已对齐 |
| `textActionImageToPrompt` | 图片反推提示词 | 创建图→文本反推预设组 | `imageToPrompt` / 图反推提示词 | `createImageToPromptGroup` | 文案略异，行为对齐 |
| `textActionTextToMusic` | 文字生音乐 | 创建文→音频预设连线组 | `textToMusic` / 文本生音乐 | `createTextToMusicGroup` | 文案略异，行为对齐 |
| — | （未见导入剧集 Key） | LibTV i18n 未出现「导入剧集」 | `importEpisodes` / 导入剧集 | 脚本剧集导入入口 | **AImanju 扩展项** |

---

## 4. 出现时机与范围

| 场景 | LibTV 行为（逆向结论） | AImanju 行为 |
|------|------------------------|--------------|
| 选中空文本节点 | 下方提示面板 + 空态建议（`textAction*`）；上方富文本工具栏不出现 | `showDefaultPromptPanel` + `EmptyQuickActions` |
| 进入「自己编写内容」 | 节点上方出现富文本工具栏（`textTool*`） | `isCustomEditorOpen` → `TextCustomToolbar` docked |
| 选中已有生成 / 自定义正文 | 可滚动预览；双击 / 进入编辑后显示工具栏 | `showCustomEditor` 只读预览；双击 `request-edit` |
| 展开编辑 | `textToolExpand` → 全屏 / 大编辑态 | `isEditorFullscreen` Teleport 全屏 |
| 复制内容 | 复制纯文本；toast「已复制到剪贴板」 | `clipboard.writeText`（toast 可再对齐） |
| 下载 | 工具栏 i18n 无专用项；空内容 → `noContentToDownload` | 工具栏直接下载 `text-content.txt` |
| 接口 | 排版 / 复制 / 背景色为纯前端；生成走文本模型任务（与工具栏无关） | 同上：上方工具栏无 HTTP 接口 |

---

## 5. 相关 AImanju 文件

| 职责 | 路径 |
|------|------|
| 上方工具栏 UI | `components/flow/text/TextCustomToolbar.vue` |
| 编辑器能力（格式 / 复制 / 下载） | `components/flow/text/TextCustomEditor.vue` |
| 编辑面板 / docked 堆叠 | `components/flow/text/TextCustomEditorPanel.vue` |
| 空态卡片挂载工具栏 | `components/flow/text/TextNodeEmptyCard.vue` |
| 空态快捷定义 | `components/flow/text/constants.ts`（`quickActions`） |
| 快捷预设打组 | `composables/flow/node/quickActions/useTextNodeQuickActions.ts` |

---

## 6. 建议后续

1. 若严格对齐 LibTV：评估**移除或降级**工具栏「下载」，或改为右键 / 批量下载入口。
2. 复制成功补 toast，文案对齐「已复制到剪贴板」。
3. 登录 LibTV 后抓包，复核色板色值、H1–H3 是否为三个独立按钮、展开态布局细节。

---

## 7. 同源 Excel

同步表格见：`docs/LibTV-文本节点-上方工具栏功能对照表.xlsx`
