# LibTV 文本节点富文本实现逆向

> 证据：线上 chunk `0bw_-e1gjqqjq.js`（TipTap 编辑器）、`00p3r2jo-1h70.js`（`MarkdownToolbar`）、i18n `textTool*`；对照仓库 `docs/LibTV-文本节点-上方工具栏功能对照.md`。  
> 日期：2026-07-17。非官方文档。

---

## 1. 结论先行

| 问题 | 答案 |
|------|------|
| **编辑器引擎** | **TipTap（底层 ProseMirror）**，React `useEditor` |
| **不是** | 原生 `execCommand` / Quill / Lexical / 纯 contenteditable 自研 |
| **改文档方式** | TipTap command chain：`editor.chain().focus().toggleBold().run()` 等 |
| **持久化格式** | **Markdown 字符串**（`editor.storage.markdown.getMarkdown()`），非 HTML、非 JSON blocks |
| **DOM** | `.ProseMirror` + `.tiptap-editor-wrapper` + `.markdown-content` |
| **工具栏组件名** | `MarkdownToolbar`（variant 默认 `floating`） |

与 AImanju：**能力集合接近**。AImanju 现已使用 **Tiptap（ProseMirror）+ HTML**，LibTV 使用 **TipTap + Markdown**；存储协议保持各自原有格式。

---

## 2. 架构示意

```text
选中文本节点 →「自己编写内容」
       │
       ▼
┌──────────────────────────────────────┐
│  TipTap Editor (useEditor)           │
│  extensions:                         │
│    StarterKit(H1–H3, list, hr,       │
│               bold, italic, …)       │
│    Placeholder                       │
│    Markdown (html:false, clipboard)  │
└──────────────┬───────────────────────┘
               │ onUpdate
               ▼
     getMarkdown() → 节点 data.content（MD）
               │
               ▼
         debounce / batch 落库

上方浮动工具栏 MarkdownToolbar
  → chain().focus().setHeading / toggleBold / …
  → 背景色改的是「节点卡片色 nodeColor」，不是文字高亮
```

---

## 3. 编辑器初始化（chunk 还原）

`0bw_-e1gjqqjq.js` 核心：

```js
useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      bulletList: {},
      orderedList: {},
      horizontalRule: {},
      bold: {},
      italic: {},
      code: {},
      codeBlock: {},
      blockquote: {},
    }),
    Placeholder.configure({ placeholder: t('canvas:textEditorPlaceholder') }), // 「输入内容…」
    Markdown.configure({
      html: false,
      transformCopiedText: true,
      transformPastedText: true,
    }),
  ],
  content: initialText ?? '',
  editable,
  immediatelyRender: false,
  editorProps: {
    attributes: { class: 'markdown-content …' },
  },
})
```

要点：

- **Markdown 扩展 `html: false`**：序列化以 MD 为准，复杂 HTML mark 会 warn。
- **剪贴板**：粘贴/复制文本走 Markdown parser/serializer（`markdownClipboard` Plugin）。
- **对外 API**：`getEditor()`、`focus()`；更新时 `storage.markdown.getMarkdown()`。

---

## 4. 工具栏如何改文档

组件：`MarkdownToolbar`（`00p3r2jo-1h70.js`）  
状态：`useEditorState` 读 `isActive('bold'|'italic'|'heading'|…)` 高亮按钮。

| UI（i18n） | TipTap 命令 |
|------------|-------------|
| 背景色 `textToolBackgroundColor` | **不走编辑器 mark**；`onColorChange(nodeColor)` 改节点卡片背景 |
| H1/H2/H3 | `chain().focus().setHeading({ level }).run()` |
| 正文 ¶ | `chain().focus().setParagraph().run()` |
| 粗体 | `chain().focus().toggleBold().run()` |
| 斜体 | `chain().focus().toggleItalic().run()` |
| 无序列表 | 若当前是 heading → 先 `setParagraph()` 再 `toggleBulletList()` |
| 有序列表 | 同上，再 `toggleOrderedList()` |
| 分割线 | `chain().focus().setHorizontalRule().run()` |
| 复制 | 回调 `onCopy`（纯文本 / 剪贴板） |
| 展开 | 回调 `onExpand`（全屏；`TextFullScreenToolbarContainer`） |

**没有** `document.execCommand`。  
StarterKit 里虽有 `code` / `codeBlock` / `blockquote`，**上方工具栏未挂按钮**（能力预留或别处用）。

---

## 5. 数据如何存

| 层 | 形态 |
|----|------|
| 编辑中 | ProseMirror JSON document（内存） |
| 对外 / 落库 | **Markdown 字符串**（`getMarkdown()`） |
| 剪贴板进出 | Markdown ↔ PM（`html: false`） |
| 节点 UI 背景 | 独立字段 `nodeColor`（工具栏色板），**不是** Markdown 里的高亮 |

落库路径（chunk 还原）：

```js
onUpdate(md) {
  updateNodeData(nodeId, { content: [md] }, { contextLabel: 'textNodeTextNode' })
  debounce(flushSave, 250)  // 250ms 后触发保存
}
```

- 编辑器输出 MD 字符串，写入节点 `content`（数组包一层 `[md]`）。
- **复制**：`navigator.clipboard.writeText(getMarkdown())`，成功 toast `copiedToClipboard`。
- **不是** AImanju 提示词区的 `promptBlocks[]`（图/视频 prompt 的文本+图片 chip）。

---

## 6. DOM / CSS 线索

| 选择器 / 类 | 含义 |
|-------------|------|
| `.ProseMirror` | TipTap 可编辑根 |
| `.tiptap-editor-wrapper` | 外壳 |
| `.markdown-content` | 内容样式（含 `blockquote`、`pre code`、链接色等） |
| `.is-editor-empty` + `data-placeholder` | 占位符「输入内容…」 |
| `MarkdownToolbar` `variant="floating"` | 节点上方浮动工具栏 |

样式片段含：`.ProseMirror:focus { outline: none }`、`min-height: 100px`。

---

## 7. 与 AImanju 对照

| 维度 | LibTV | AImanju（现状） |
|------|-------|-----------------|
| 引擎 | **TipTap / ProseMirror** | **Tiptap 3 / ProseMirror** |
| 存储 | **Markdown** | **HTML**（`modelValue` 字符串） |
| 工具栏命令 | `editor.chain()…` | `editor.commands` / `editor.chain()`，保留既有工具栏接口 |
| 功能集 | 背景色(节点)、H1–3、正文、粗斜体、列表、分割线、复制、展开 | 基本同集；**多了下载** |
| 提示词区 | 另一套（生成 prompt） | `PromptBlockEditor` contenteditable + `promptBlocks` |
| 依赖体积 | TipTap + MD 扩展 | `@tiptap/vue-3`、StarterKit 与 HTML 兼容扩展 |

对齐建议（若要行为一致、实现可不同）：

1. 功能集已基本对齐；节点存储格式仍有差异。  
2. AImanju 文本节点继续保存 HTML，剧本发送页沿用 HTML↔Markdown 转换，不因编辑器迁移改变协议。  
3. 背景色应对齐为**节点级**，而非文字选区高亮。  
4. 下载为 AImanju 扩展；LibTV 工具栏无独立 download key。

---

## 8. 相关 chunk / 文档

| 资源 | 内容 |
|------|------|
| `…/chunks/0bw_-e1gjqqjq.js` | TipTap `useEditor` + Markdown 扩展 + Placeholder |
| `…/chunks/00p3r2jo-1h70.js` | `MarkdownToolbar`、`textTool*` 按钮与 command |
| `…/chunks/0k7fqrmbis_k..js` | TipTap / ProseMirror 运行时 |
| [LibTV-文本节点-上方工具栏功能对照.md](./LibTV-文本节点-上方工具栏功能对照.md) | 功能与 i18n 对照（此前已整理） |

---

## 9. 一句话

> LibTV 文本富文本 = **TipTap 编辑 Markdown**；工具栏用 **command chain** 改文档；落库是 **MD 字符串**；「背景色」是 **节点卡片色**，不是字色高亮。
