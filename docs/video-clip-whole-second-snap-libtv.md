# 视频剪辑「整秒吸附」对齐 LibTV

本文记录从 LibTV 视频剪辑条逆向得到的真实算法，以及本项目应对齐的实现方案。  
产品文案写「整数秒」，**代码并不是硬吸到 1 秒整数**。

范围仅限画布视频节点剪辑条（胶片条左右切点）。不要和成片时间轴的「吸附 / 关闭吸附」（`clipSnapOn` / `clipSnapOff`）混用。

---

## 1. LibTV 源

| 项 | 值 |
|---|---|
| 组件 | `VideoClipBar` / `SelfContainedVideoClipBar`（压缩名 `eh`） |
| 磁吸函数 | `G(e)` |
| 开关状态 | `C`，`useState(false)`，ref `$` |
| i18n | `canvas:videoClipBarText2f5a05` / `canvas:videoClipBarClose` |

还原后的磁吸函数：

```js
function G(e) {
  if (!snapEnabled) return e
  const t = 0.5 * Math.round(e / 0.5)
  return Math.abs(e - t) <= 0.1 ? t : e
}
```

压缩原文：

```js
let G = (e) => {
  if (!$.current) return e
  let t = .5 * Math.round(e / .5)
  return .1 >= Math.abs(e - t) ? t : e
}
```

`$` 是吸附开关 ref。关闭时 `G` 原样返回指针时间。

---

## 2. 行为契约（以代码为准）

### 2.1 磁吸本身

- 刻度：**0.5 秒**（不是 1 秒）。
- 半径：**距最近 0.5 秒刻度 ≤ 0.1 秒才吸过去**，否则跟手。
- 先 `G(pointer)`，再做选区钳制。磁吸函数内部**不**做 min/max。

### 2.2 哪些操作走 `G`

| 操作 | 是否调用 `G` |
|---|---|
| 左切点拖动 `start` | 是，然后 `start = max(0, min(G(n), end - 1))` |
| 右切点拖动 `end` | 是，然后 `end = min(duration, max(G(n), start + 1))` |
| 选区整体平移 `region` | **否**，按按下时的跨度平移，只贴时间轴两端 |
| 键盘 ← → ↑ ↓、I / O | **否** |
| 点击胶片 seek | **否** |

最短选区 **1 秒**（`end - 1` / `start + 1`）。

### 2.3 默认值与文案

| 项 | LibTV |
|---|---|
| 吸附默认 | **关** |
| 选区循环默认 | **开** |
| 磁铁关闭提示 | 开启整数秒吸附 |
| 磁铁开启提示 | 关闭整数秒吸附 |
| 循环关闭提示 | 开启选区循环播放 |
| 循环开启提示 | 关闭选区循环播放 |

开关本身不改当前切点，只影响之后的左右拖动。

### 2.4 与吸附无关：Shift 0.5 秒刻度线

按住 Shift 时 `T = true`，胶片上画 0.5 秒竖线：

```js
Array.from({ length: Math.floor(2 * duration) }, (_, i) => (i + 1) * 0.5)
  .filter((sec) => sec < duration)
```

快捷键面板把 Shift 标成「精确模式」。这是视觉辅助，**不调用 `G`**。本项目已有 Shift 抽帧白边，不要把刻度线塞进吸附开关。

### 2.5 键盘（对照，本方案不改步进）

LibTV 剪辑条：

- 默认步长 **0.1 秒**
- `Ctrl` / `Meta` 时 **1 秒**
- `←` / `→` 平移整段，`↑` / `↓` 改右缘，`I` / `O` 用播放头设入出点
- 全部**不经过** `G`

本项目键盘仍按胶片像素步进。要对齐吸附时不要顺手改键盘步长。

---

## 3. 浮点边界

IEEE754 下 `2.6 - 2.5 === 0.10000000000000009`，严格 `<= 0.1` 时 **2.4 / 2.6 / 1.9 吸不上**，而 `7.4 / 7.6` 可以。这是 LibTV 原比较的副作用，不是产品意图。

本项目比较时加 `1e-9` 容差，让「0.1 秒半径」在 2.6 这类刻度边缘成立；`2.61` 仍跟手。

```ts
Math.abs(pointerSec - snappedSec)
  <= CLIP_SECOND_SNAP_THRESHOLD_SEC + 1e-9
```

---

## 4. 本项目现状

| 位置 | 现状 |
|---|---|
| `VideoClipPanel.vue` | 磁铁 `snapToFramesEnabled`，默认关，**未接入拖动** |
| `VideoFilmstripBar.vue` | 左右切点直接 `resolveResizeLeft/RightByPointerSec(pointerSec)` |
| `clipRange.ts` | 只有 1 秒下限钳制，无 0.5 秒磁吸 |
| 平移 / 键盘 | 不吸附（已与 LibTV 一致） |
| Shift | 抽帧白边，不是 0.5 秒刻度线 |

应对齐的是 LibTV 的 `G()`，不要做成「四舍五入到整数秒」。

---

## 5. 落地方案

### 5.1 `clipRange.ts`：纯函数磁吸

```ts
/** LibTV 整数秒吸附的刻度（实际按 0.5s） */
export const CLIP_SECOND_SNAP_STEP_SEC = 0.5

/** 距刻度不超过该距离才吸附，否则保持指针时间 */
export const CLIP_SECOND_SNAP_THRESHOLD_SEC = 0.1

/** 覆盖 0.1s 边界上的浮点误差 */
const CLIP_SECOND_SNAP_THRESHOLD_EPSILON_SEC = 1e-9

/** 先落到最近 0.5s，仅当距离 ≤ 0.1s 时才吸附；合法区间由后续把手钳制。 */
export function resolveWholeSecondSnapSec(pointerSec: number): number {
  if (!Number.isFinite(pointerSec))
    return pointerSec
  const snappedSec =
    CLIP_SECOND_SNAP_STEP_SEC * Math.round(pointerSec / CLIP_SECOND_SNAP_STEP_SEC)
  if (
    Math.abs(pointerSec - snappedSec)
    <= CLIP_SECOND_SNAP_THRESHOLD_SEC + CLIP_SECOND_SNAP_THRESHOLD_EPSILON_SEC
  )
    return snappedSec
  return pointerSec
}
```

函数不要接收 min/max。钳制继续走现有 `resolveResizeLeftByPointerSec` / `resolveResizeRightByPointerSec`。

### 5.2 `VideoFilmstripBar.vue`：只在左右切点调用

增加 `snapToWholeSeconds`（默认 `false`）。

```ts
function resolveResizePointerSec(pointerSec: number): number {
  if (!props.snapToWholeSeconds)
    return pointerSec
  return resolveWholeSecondSnapSec(pointerSec)
}
```

`resize-left` / `resize-right` 用磁吸后的时间再判断 1 秒下限、再钳制。  
`move` 仍走 `resolveMoveByPointerDeltaSec`，不调用磁吸。

### 5.3 `VideoClipPanel.vue`：开关与文案

- 状态改名为 `snapToWholeSecondsEnabled`，默认 `false`。
- 传给胶片条 `:snap-to-whole-seconds`。
- 提示随开关切换：关 →「开启整数秒吸附」，开 →「关闭整数秒吸附」。
- 打开开关时不要改写当前选区。

### 5.4 不改

- 整体平移、键盘步进
- 选区循环默认开
- Shift 精确模式（抽帧白边）
- 最短 1 秒选区

### 5.5 测试与契约

`clipRange.test.ts`

- `2.5 → 2.5`，`2.6 / 2.4 → 2.5`，`1.9 → 2`
- `2.61`、`2.8`、`1.8` 保持指针时间
- `NaN` 保持 `NaN`
- 磁吸后再钳制：例如终点 3.4、指针 2.6 → 先吸到 2.5，再被 1 秒下限收到 2.4

`VideoFilmstripBar.test.ts`（400px / 10s 轨道）

- 开吸附，左切 104px（2.6s）→ `clipStartSec = 2.5`
- 开吸附，左切 108px（2.7s）→ `2.7`（超出半径）
- 开吸附，右切 304px（7.6s）→ `clipEndSec = 7.5`
- 开吸附，整体平移仍为小数秒（如 2.3–5.8 移到 3.3–6.8）

`VideoClipPanel.test.ts`

- 默认磁铁未激活；点击后 `snapToWholeSeconds` 为 true
- `title` / tooltip：关「开启整数秒吸附」，开「关闭整数秒吸附」

`tests/regression/contracts.json` 的 `video-clip-editing`：

> 开启整秒吸附后左右切点拖动按 0.5 秒刻度磁吸（距刻度超过 0.1 秒则保持指针时间），仍保持至少 1 秒选区且整体移动与键盘步进不受影响。

---

## 6. 示例

指针时间 → `G()`（含 1e-9 容差）：

| 指针 | 最近刻度 | 距离 | 结果 |
|---|---|---|---|
| 2.50 | 2.5 | 0 | 2.50 |
| 2.59 | 2.5 | 0.09 | 2.50 |
| 2.60 | 2.5 | 0.10 | 2.50 |
| 2.61 | 2.5 | 0.11 | 2.61 |
| 2.80 | 3.0 | 0.20 | 2.80 |
| 1.90 | 2.0 | 0.10 | 2.00 |

左切拖到 2.6、右缘 3.4：磁吸 2.5 后再钳制 → 起点 2.4、跨度 1.00s。
