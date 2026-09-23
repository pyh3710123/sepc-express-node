AImanju 灰度上线架构审查 · 2026-09-22

> 本文保留修复前的审查依据；修复后的实际执行结果见 [灰度上线复查记录](./gray-release-recheck-2026-09-22.md)。

**结论：已有可继续沿用的工程架构，但当前版本不建议直接向外部用户开放灰度。先解决账号隔离、媒体代理、内容安全、保存失败处理、登录续期及冲突时的安全停止，再完成发布验收。**

根据用户后续明确的范围，本次只要求现有开放功能安全、结果正确、失败有明确处理。草稿、离线编辑、崩溃恢复等产品能力可以后置；不能把完整恢复体系或自动冲突合并作为本次必做功能。下表是收敛后的灰度范围，后文保留原审查依据，能力完善建议不自动进入本次开发范围。

| 分类 | 本次最小要求 | 可以后置的部分 |
| --- | --- | --- |
| 必修：账号隔离 | token、CookieRef、续期状态与等待请求按当前用户／SSR 请求隔离 | 不要求为此重做整套登录架构 |
| 必修：媒体代理 | 受保护地址不可访问，转发来源与重定向受控，耗时和实际传输大小有上限；部署侧已有等效防护可复用并验收 | 通用代理平台、完整流量治理平台 |
| 必修：内容安全 | 当前 HTML／Markdown 展示入口去除危险内容，纯文本正确转义 | 新编辑器功能和内容格式扩展 |
| 必修：登录续期 | 并发请求在续期成功、失败、超时后均能结束；旧会话请求不跨账号重放 | 更复杂的账号体验优化 |
| 必修：保存结果 | 成功以服务端确认为准；失败保留当前页面内容并提示；站内离开时允许重试或明确放弃 | 本地草稿、离线编辑、跨刷新恢复、浏览器崩溃后恢复 |
| 必修：冲突安全停止 | 收到版本冲突时不能仅换新版本号强推旧内容；最低停止自动重试、保留当前编辑并提示 | 自动合并、复杂冲突解决界面；若灰度开放多人协作，仍须验收该流程 |
| 开放范围验收：模型 | 仅验收本次开放的模型／模式，确保参数、询价、实际生成和保存一致；发现实际差异则修复或关闭受影响功能 | 未来模型、未开放 feature 及通用能力扩展 |
| 发布验收 | 当前候选版本通过既有提交／CI 门禁和生产构建；真实后端主链路、双账号权限、可用回滚和基本故障定位有证据 | 完整监控仪表盘、全链路追踪、自动灰度系统和自动回滚 |

“不开放”需要由实际配置、权限或入口限制落实。尤其是同一用户的两个标签页也可能发生写入冲突，因此不开放多人协作并不能直接取消冲突安全处理。完整远程监控平台可以后置；灰度期间最低应能收集问题、查看相关日志并定位请求，由明确负责人跟进。

审查基线为分支 `feature/tiptap-editor-migration`、提交 `8e87bfa4`。用户明确本次目标为“小范围试用／灰度上线”。本报告来自当前工作区的静态审查，重点追踪登录、HTTP、媒体代理、画布保存、协作、生成、上传和发布门禁；没有逐行审计全部业务代码，也没有访问生产系统或验证后端实现。

当前 `ai-check.config.json` 为 `regressionEnabled=false`。遵循仓库规则，没有运行类型检查、单元测试、E2E、覆盖率、依赖审计或生产构建，没有修改业务代码、测试、校验开关或提交代码。

现有架构的整体判断如下。

| 维度 | 已有实现 | 灰度判断 |
| --- | --- | --- |
| 应用分层 | Nuxt 3 / Vue 3 / TypeScript；页面、组件、composable、工具、API、类型分层；画布采用 CSR，其余页面保留 SSR | 技术选型和主要职责划分可继续沿用 |
| 画布状态 | 业务节点与 Vue Flow runtime 分离；事务、脏追踪、baseline、保存队列、远端适配器分别实现 | 主干清楚，异常恢复仍有阻断问题 |
| 保存协议 | 节点／连线 batch、视口 PUT、工作流执行三条通道分离；batch 带版本号并串行保存 | 设计合理，但失败后的离开保护与冲突合并不足 |
| 模型生成 | 多种节点复用生成工厂与参数构建器；任务集中轮询，带网络退避和跨标签协调 | 已有工程化基础；feature 过滤与最终请求一致性仍需收敛 |
| 媒体上传 | 使用 OSS STS 临时凭证，支持过期判断、刷新与上传元数据登记 | 前端路径合理；STS 权限范围仍需后端验收 |
| 自动化 | 静态统计有 810 个 `.test.ts` / `.spec.ts` 文件及 24 个正式 E2E 文件；配置了多浏览器、多系统任务 | 数量和配置不等于本次发布通过，缺当前提交执行证据 |
| 生产运维 | 画布关键事件落控制台与本地 IndexedDB | 未在仓库中发现远程错误收集闭环；生产配置和回滚能力未核验 |

下列问题按优先级排列。P0 表示开放外部访问前必须处理的安全问题；P1 表示受影响功能灰度前应修复或明确关闭的问题；“未验证”不等于服务端或部署平台一定没有该能力。

1. **P0：SSR 登录凭据使用进程级可变单例，存在跨请求串用风险。**

   [authCookieRefs.ts](/Users/mac/AImanju/composables/auth/authCookieRefs.ts:4) 在模块顶层保存 token / refreshToken 引用；[auth-cookies.ts](/Users/mac/AImanju/plugins/auth-cookies.ts:4) 是同时运行于服务端和客户端的插件，每个请求都会改写该对象。[useAuth.ts](/Users/mac/AImanju/composables/auth/useAuth.ts:59) 优先从这个单例读取 Cookie。与此同时，[request.ts](/Users/mac/AImanju/utils/http/request.ts:41) 的刷新 Promise 和等待队列也在模块顶层共享。

   在两个用户的 SSR 请求发生交错、特别是异步响应触发续期或重放请求时，后续读取可能取得另一请求的凭据引用。代码中缺少按 Nuxt 应用／请求隔离这一层，不能依赖低并发避免问题。Nuxt 官方也明确提示模块级响应式状态会跨 SSR 请求共享，见 [Nuxt 状态管理说明](https://nuxt.com/docs/getting-started/state-management/)。这是基于代码结构的风险判断，本轮没有进行双用户动态复现，也不表示已发生数据泄露。

   修复方向：将 CookieRef、刷新状态和请求等待状态绑定到当前 Nuxt 应用／SSR 请求，客户端再在应用范围内共享；认证异步链路显式保留当前请求上下文。不要把原始凭据加入会序列化到 HTML 的公共状态。

   放行验证：两套不同 Cookie 并发 SSR；其中一方 token 失效并延迟刷新，确认上游 Authorization、响应 Set-Cookie、页面内容始终属于各自用户。

2. **P0：服务端媒体代理的目标校验不足，存在 SSRF 和资源滥用入口。**

   [imageProxy.ts](/Users/mac/AImanju/server/utils/media/imageProxy.ts:29) 只对 hostname 做部分字符串黑名单判断；audio / download 代理采用类似逻辑，没有对普通媒体目标设置可信域名白名单，也没有校验 DNS 解析后的实际地址。[image-proxy.get.ts](/Users/mac/AImanju/server/api/media/image-proxy.get.ts:29) 直接 `fetch`，未禁止或逐跳校验重定向。

   因此，初始 URL 通过字符串检查不代表最终连接地址安全；域名解析到内网、重定向到内网以及部分 IPv6 地址都没有完整防护。响应类型检查发生在请求已经发出之后，不能阻止内部网络访问。这与 [OWASP SSRF 防护说明](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) 所指出的重定向和 DNS 风险一致。

   这些 handler 中还没有鉴权、限流和应用级请求超时；大小限制仅依赖远端 `Content-Length`，缺失该头时没有流式累计限制。图片代理接受全部 `image/*` 并原样以同源内容返回，其中包括 SVG，需要额外限制主动内容类型。边缘网关是否另有保护，本轮未验证。

   修复方向：统一代理安全入口，收敛可信资源来源，校验最终连接地址，限制重定向、端口、总耗时和实际传输字节，补齐鉴权／签名和并发限制；禁止主动 SVG 内容作为站点同源文档返回，或使用隔离域及适当响应策略。

   放行验证：只在隔离环境验证内网 DNS、IPv6、重定向、无长度流、慢响应和 SVG 文档；确认请求在连接受保护目标前被拒绝。

3. **P0：富文本／Markdown 存在未清洗 HTML 的直接展示路径。**

   [scriptSendMarkdown.ts](/Users/mac/AImanju/utils/opera/scriptSendMarkdown.ts:6) 将 `marked.parse` 结果直接返回，异常分支也直接插入原文；随后 [SendMarkdownPreview.vue](/Users/mac/AImanju/components/Opera/Send/SendMarkdownPreview.vue:38) 使用 `v-html` 展示。Marked 官方明确说明输出 HTML 不做安全清洗，见 [Marked 文档](https://marked.js.org/)。

   另一条路径是 [formatScriptPlainTextToHtml.ts](/Users/mac/AImanju/utils/flow/formatScriptPlainTextToHtml.ts:20)：只要识别为 HTML 就原样返回，并由文本节点预览的 `v-html` 使用。[CommonAssetPreviewDialog.vue](/Users/mac/AImanju/components/Common/CommonAssetPreviewDialog.vue:199) 也直接渲染文本资源的 `src`。

   当导入、模型输出、远端节点或共享素材带有危险 HTML 时，这些前端边界无法保证安全。现有 token / refreshToken 是 JavaScript 可读 Cookie，会扩大 XSS 成功后的影响。是否还有后端清洗或网关 CSP，本轮没有证据；前端不应据此默认上游 HTML 安全。

   修复方向：建立所有富文本展示共用的允许列表清洗入口；纯文本统一转义；限制 URL 协议、事件属性和主动内容。编辑器结构规范化不能替代安全清洗，并应保留现有列表、表格、图片等合法内容。

   放行验证：通过文本节点、共享素材、剧本 Markdown、导入和协作详情分别输入无害的事件属性／危险链接探针，确认不执行脚本，同时合法富文本显示与保存不变。

4. **P1：保存失败后仍允许无提示离开；本地草稿与跨刷新恢复可后置。**

   [useWorkflowPersistence.ts](/Users/mac/AImanju/composables/workflow/useWorkflowPersistence.ts:88) 明确不读写浏览器草稿，加载时也忽略旧草稿。当前 `markWorkflowDirty` 只标记内存状态；仓库保留的 `draftStorage.ts` 并未接入这条画布保存链路。这与 README 中“标脏写本地草稿”的说明存在偏差。

   [保存失败分支](/Users/mac/AImanju/composables/workflow/useWorkflowPersistence.ts:271) 设置错误状态后直接返回，使 flush Promise 正常结束；[路由离开钩子](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchLifecycle.ts:45) 只等待这个 Promise，没有根据保存结果中止导航。关闭／刷新页面时则只是发起一次不等待的保存。

   可复现条件：修改节点 → batch 持续返回错误或网络不可用 → 跳转其他页面／刷新 → 待保存内容只在旧页面内存中，不能恢复。现有测试也明确约定“页面内存保留脏状态”，所以不能把草稿工具文件的存在算作恢复能力。

   本次修复范围：让 flush 返回明确结果，保存未完成或失败时保留当前页面内容，站内离开时明确提供重试／放弃选择。跨刷新恢复不属于本次要求；浏览器崩溃、强制关闭或用户明确放弃后的未同步内容不承诺恢复。后续若设计恢复日志，应按账号／画布／远端版本隔离并在恢复前对齐远端状态，保留“服务端详情为权威基线”的现有意图，避免简单恢复旧整图造成协作覆盖。

   放行验证：HTTP／业务保存失败、请求处理中再次编辑和站内路由切换时，失败不显示已保存、不无提示离开；已确认保存的内容在刷新与重开后与服务端一致。不要求恢复断网期间未保存且页面已经关闭的内容。

5. **P1：登录刷新失败时，部分等待请求可能永久不结束。**

   [request.ts](/Users/mac/AImanju/utils/http/request.ts:229) 遇到业务 401 后将执行函数放入全局队列。只有触发刷新的那个请求在刷新失败时执行 `reject`，其余等待项没有失败通知，也没有统一清空；队列仅保存执行函数，无法逐一拒绝对应 Promise。[refreshAuth](/Users/mac/AImanju/api/login/index.ts:45) 直接调用 `$fetch`，没有沿用普通请求的超时配置。

   可复现条件：两个请求同时 401 → `/auth/refresh` 失败 → 其中一个请求被拒绝，另一个继续 pending。如果重放后仍返回 401，刷新标记仍为 true，请求也可能再次入队而无人继续处理。表现可能是保存、积分或生成按钮一直等待；残留请求还可能在以后刷新成功时被重放。

   修复方向：每个请求等待同一个有超时的刷新结果，统一传播成功／失败，限制续期后的重试次数；退出和切换账号时终止旧会话等待项。与第 1 项一起完成作用域隔离。

   放行验证：并发 401 后刷新成功、失败、超时、刷新后再次 401、退出再登录；所有原请求都应在有限时间结束，旧写请求不得跨会话重放。

6. **P1：协作版本冲突通过更换版本号重试，缺少此分支内的远端内容合并。**

   [useWorkflowPersistence.ts](/Users/mac/AImanju/composables/workflow/useWorkflowPersistence.ts:256) 在冲突后更新 `version`，修改 pending op 的基准号，再安排保存；[rebaseCanvasOpLog](/Users/mac/AImanju/composables/workflow/persistence/canvasOpRebase.ts:38) 只替换版本元数据，不拉取或合并远端文档。保存队列没有为持续冲突设置退避和次数限制。

   若本地尚未收到另一端的更新，这条重试会使用旧本地内容配合新版本号再次提交，存在覆盖他人字段的风险。协作层确实有断线／版本缺口重同步，但这不能证明 batch 冲突分支每次都会先完成重同步。后端是否另有字段合并或锁约束，本轮未验证。

   本次最低范围：冲突后停止自动提交，保留当前页面编辑并明确提示，不通过替换版本号强行覆盖远端内容。自动拉取、重放／合并增量及冲突解决界面可以后置。若本次开放多人协作，必须验收用户如何处理冲突；若不开放，应由实际权限与会话策略落实限制。同一用户多标签页仍可能冲突，需要保留安全停止路径。

   放行验证：两端分别改同节点不同字段、同时改同字段、删除与编辑交错、WS 延迟、断线重连及连续冲突，检查最终服务端状态、双方 UI 和保存次数。

7. **P1（受影响模型功能）：feature 约束与最终 HTTP 请求尚未完全统一。**

   [nodeGenerationConfig.ts](/Users/mac/AImanju/utils/flow/nodeGenerationConfig.ts:146) 在未传白名单时保留所有 features，持久化构建器正是无白名单调用；[buildGenerationParams.ts](/Users/mac/AImanju/utils/flow/buildGenerationParams.ts:233) 同样直接复制 features。当前仍存在后端未声明功能的过渡透传路径，尚未达到仓库 §6 要求的完整能力约束。

   此外，[视频 create 适配](/Users/mac/AImanju/api/task-generation/index.ts:30) 在 HTTP 出口仅保留 `generate_mode`（批量另保留关联 id），而 [credit 出口](/Users/mac/AImanju/api/node/index.ts:82) 没有相同处理。共同 Builder 并不足以保证最终发出的 body 一致；例如 Builder 可以附加 `style_id` / `support_models`，create 出口会删除这些视频 feature，credit 会保留。

   修复方向：以选中的 capability 为依据，在共同归一入口处理普通参数及 feature，credit、create、batch 从同一结果派生。要么三者共同支持该功能，要么共同移除；不在单个接口出口另做未同步的裁剪。

   放行验证：对灰度开放的实际模型／模式逐一比较最终 credit、create、保存 body；覆盖切换到不支持 feature 的模型，以及带有旧字段的节点详情。

8. **P1：尚无足够的生产运行与发布放行证据。**

   [canvasObservability.ts](/Users/mac/AImanju/utils/flow/canvasObservability.ts:14) 目前记录到 console 和浏览器 IndexedDB，未接入可集中查询、告警的远程链路。发生保存失败、生成失败或协作断开时，维护者不能仅靠这些本地日志及时掌握总体情况。

   `.github/workflows/test.yml` 配置了类型检查、覆盖率、构建和跨平台 E2E，但当前 `origin` 指向自建 Git 服务。本轮未取得该平台实际运行记录或分支保护设置，不能认定 `quality-gate` 已成为发布阻断条件。仓库自己的 [回归说明](/Users/mac/AImanju/tests/regression/README.md:41) 也明确区分工作流文件与平台接入。

   [Playwright 配置](/Users/mac/AImanju/playwright.config.ts:40) 启动开发服务器；抽查的工作台和协作 E2E 使用接口／WebSocket 桩。它们有前端回归价值，但不能替代生产构建配合真实后端的上线验收。当前全局覆盖率门槛是最低防线，不能当作实测覆盖率或质量评分。

   灰度最低要求：能通过基本日志与反馈定位保存／生成／登录失败，关联信息需脱敏；有明确的发布版本、负责人和可用的回滚方式；取得本次提交的门禁结果；在部署后的候选版本上完成真实登录、上传、生成、保存与重开流程。完整集中监控、追踪和自动告警平台可后置。后端权限、实际扣费／任务幂等与部署安全需要验收已有能力，缺少本轮证据不等于必须新建一套系统。

后续维护还应逐步处理模块体量与协议文档漂移：`useFlowWorkbenchState.ts` 为 3,677 行，协作编排为 3,130 行，多个节点 orchestrator 超过 2,000 行。它们会增加定位和修改风险，但文件体量本身不是本次灰度的直接阻断条件。应在稳定行为保护下按职责拆分，避免发布前扩大改动范围。用户／通用接口中的宽泛 `any` 也应逐步收紧。

建议的灰度放行顺序如下。

| 顺序 | 必须完成的结果 | 验收证据 |
| --- | --- | --- |
| 1 | 处理 SSR 凭据隔离、代理安全和 HTML 清洗 | 隔离环境安全回归，无跨用户状态污染 |
| 2 | 保存失败保留当前页面内容且不会无提示离开；续期请求有明确结束状态 | 保存失败、站内导航、并发 401 的行为用例；不要求跨刷新恢复 |
| 3 | 冲突安全停止，协作与模型功能按实际支持范围开放 | 冲突不会强推覆盖；已开放功能的请求与结果记录 |
| 4 | 当前提交通过项目门禁及生产构建 | 完整 CI 记录；提交前执行 `npm run check:commit` |
| 5 | 候选部署连接真实后端完成主链路 | 登录 → 上传 → 生成 → 保存 → 刷新／重开；后端鉴权、任务幂等、计费结果核对 |
| 6 | 可定位问题并撤回版本 | 基本反馈／日志可查、负责人明确、上一版本可恢复；不要求完整监控平台 |
| 7 | 限定账号、并发、任务额度及开放功能 | 逐批开放与观察记录；容量上限根据实测确定 |

浏览器与系统本轮均未实测。待验证范围：macOS 的真实 Safari、Firefox、Chrome／Edge，以及 Windows 的 Firefox、Chrome／Edge；优先覆盖保存与重开、媒体上传／下载、中文输入、快捷键和画布拖拽。WebKit 自动化不能替代真实 Safari 验收。

实际执行的是 `git status --short`、`git ls-files`、`git rev-parse`、`git branch`、`rg`、`cat`、`nl`、`sed` 及只读文件统计，结果用于源码定位、配置检查和规模统计；另查阅 Nuxt、Marked 与 OWASP 官方资料核对安全机制。未执行 `npm run check:ai`、`npm run check:commit`、`npm run typecheck`、Vitest、Playwright、覆盖率、构建或性能测试，不能宣称这些检查通过。没有当前部署、后端源码、压测、CI 与分支保护证据，因此本报告不对实际并发容量、后端权限隔离、计费幂等、备份恢复或全平台兼容作通过判断。
