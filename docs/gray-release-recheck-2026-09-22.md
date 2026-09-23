AImanju 灰度上线复查 · 2026-09-22

**结论：六项修复已通过本地相关验证，暂不能直接给出灰度发布放行。** 发布门禁还存在组内文本 E2E 与既有增量协议的断言冲突，修订等待维护者确认；部署环境与真实后端尚未验收。草稿恢复、离线编辑、自动冲突合并不增加到本次范围。

用户确认尚未部署，先检查本地代码。本记录基于当前未提交工作区，不能作为远端 CI、真实后端或实际部署已经通过的证明。

**本轮修改**

- 补齐分享画布 `useFlowProjectDetail` 对请求级认证会话的接入，移除全局认证对象的残留引用；补充两个分享实例分别监听各自 token 的回归。
- 明确请求失效分支返回 `Promise<never>`，统一请求保持 `Promise<T>`，修正导致 API 调用链类型检查失败的推断。
- 补充保存状态、编排传递、富文本展示、音频语气标记往返、离开保护、快捷派生选区及聚焦尺寸回退的行为验证，保留原覆盖率基线。
- 修正 E2E 对 Teleport 成员菜单的定位，并让文本断言跟随当前可见正文，避开渐进挂载时的隐藏副本。原正文、位置、连线与保存次数检查均保留。
- 新增浏览器验收：保存失败取消离开、重试成功后刷新、冲突后不强推，以及历史富文本事件和危险链接的清洗。

**实际验证**

`ai-check.config.json` 保持 `regressionEnabled=false`。本轮按用户要求手动执行上线复查，没有改开关或使用 `check:ai` 的跳过结果充当通过。Node 使用 `.nvmrc` 对应的 22（本机 22.22.2）。

| 检查 | 命令或方式 | 结果 |
| --- | --- | --- |
| 变更规则 | `npm run check:policy` | 通过 |
| 类型检查 | `npm run typecheck` | 最终复验通过 |
| 生产构建 | `npm run build`，含类型门禁 | 通过，生成 Node Nitro `.output` |
| 全量测试与覆盖率 | `npm run test:coverage` | 813 个文件、7,137 个用例全部通过；69 个门禁自测通过；画布核心覆盖率全部达标 |
| 全局覆盖率 | 同上 | 行/语句 68.03%，分支 81.68%，函数 82.14% |
| 灰度安全与工作区冒烟 | Firefox、Chromium，`gray-release-safety.e2e.ts`、`workbench-smoke.e2e.ts` | 16 条全部通过 |
| 普通文本四档缩放 | Firefox、Chromium，`text-rich-editor.e2e.ts --grep '普通文本节点'` | 8 条全部通过，含编辑、保存一次、尺寸、连线与刷新 |
| 生产服务 HTTP 冒烟 | 直接访问本机 Nitro 服务 | `/flow` 返回 200；四个媒体代理对回环、链路本地、IPv6 回环目标均返回 400 |
| 补丁完整性 | `git diff --check` | 通过 |

浏览器命令统一使用 `PLAYWRIGHT_BROWSERS=firefox,chromium npx playwright test <上述测试文件> --workers=1`。运行的是本次生产构建产物，服务仅监听 `127.0.0.1:4173`，静态资源运行时指向本机，API/WS 使用测试桩；没有发布或向真实后端提交测试写入。本次未暂存、提交或部署。未运行要求暂存一致性的 `npm run check:commit`，提交时仍必须执行。

**尚未放行的测试契约**

组内文本用例要求纯正文修改的 update 请求携带原 `parent_uuid`。现有 `utils/workflow/workflowNodeSave.ts` 的 `resolveBatchMutationParentUuid` 在父组未变化时明确省略该字段，故两个浏览器、四档缩放共 8 条用例在该断言失败。不能据此认定实际发生了分组丢失，也不能隐藏测试失败。

已准备 [具体修订](./text-rich-editor-contract-adjustment-2026-09-22.patch)：检查未变化的父组不重复提交，新增保存后、刷新后仍保留原分组的检查，继续保留正文、尺寸、位置、连线与保存次数断言。当前尚未应用这项语义调整。`AGENTS.md` §0.1 要求“调整断言语义须先说明替代保护并获得维护者明确认可”，已请求用户确认。

**部署后待验收**

1. 候选版本连接真实后端，跑通登录/续期 → 上传 → 开放模型生成 → 保存 → 刷新/重开，核对实际保存结果及失败提示。
2. 验证双账号权限隔离、两端版本冲突、任务与额度结果；测试桩不能证明后端权限或计费正确。
3. 确认本次静态资源已上传到生产 CDN 配置的版本目录，前后端、HTTPS 和 WS 配置一致；取得实际 CI/分支门禁结果，准备可恢复的上一版本和基本故障日志。

实际浏览器环境为 macOS 13.3 ARM 的 Firefox 与 Chromium。当前 Playwright 不支持在 macOS 13 ARM 运行 WebKit；真实 Safari、Windows Firefox/Chrome/Edge 均未验证，需在支持的系统及 CI 验证编辑保存、上传下载、中文输入、快捷键与画布交互。本次未运行全部 E2E 文件，不能宣称全平台或完整远端发布门禁通过。

**本机证据**

- `/private/tmp/aimanju-gray-build.log`
- `/private/tmp/aimanju-gray-final-typecheck.log`
- `/private/tmp/aimanju-gray-coverage.log`
- `/private/tmp/aimanju-gray-policy.log`
- `/private/tmp/aimanju-gray-final-browser.log`
- `/private/tmp/aimanju-gray-text-browser.log`
- `coverage/index.html`、`coverage/coverage-final.json`

早期检查确实出现过类型错误、覆盖率不足及 E2E 定位失败；表内记录修正后的结果，组内文本断言问题单独保留为待处理项。
