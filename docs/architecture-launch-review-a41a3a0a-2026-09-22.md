AImanju 当前版本架构与上线审查 · 2026-09-22

**结论：架构主干可以继续用于上线，但当前版本不建议直接正式放行。先处理下列跨模块边界问题，再对同一候选构建完成发布验收。没有发现需要在上线前更换框架或整体重构的依据。**

审查基线：分支 `feature/tiptap-editor-migration`，提交 `a41a3a0a8b644622f7b80efb5f578553d75f6889`。开始与结束读取源码时 Git 工作区均干净。本报告只新增到已忽略的 `docs/`，不修改业务源码、测试、配置或提交代码。

本次对应用入口、认证与 HTTP、画布状态／保存／协作、生成参数与任务、OSS 上传、服务端媒体代理、富文本展示、CI 和部署配置进行静态追踪，并读取相关测试与既有复查记录。未逐行审计全部业务代码；仓库不包含完整业务后端，未访问生产服务、云平台或远端 CI。下文区分源码确认的问题、取决于部署防护的风险，以及尚未取得的验收证据。

当前 `ai-check.config.json` 为 `regressionEnabled=false`。依据仓库 §0，本轮未自动运行类型检查、测试、覆盖率、依赖审计、浏览器验证或构建。历史报告的验证结果不等于本轮执行结果。

**架构评估**

| 维度 | 当前实现与判断 | 上线前重点 |
| --- | --- | --- |
| 应用与部署 | Nuxt 3、Vue 3、TypeScript 严格模式；页面／组件／composable／utils／API 分层。画布 `/flow` 使用 CSR，其余页面保留 SSR | 现有媒体代理使用 Node 网络与流 API，部署应承载 Nitro 服务；CDN 负责静态资源 |
| 画布状态 | 业务节点、Vue Flow runtime、坐标同步、事务与脏追踪分别建模 | 保留既有坐标、连线端点、组归属与拖拽收口契约，继续验证大画布场景 |
| 持久化 | 节点／连线 batch、视口 PUT、workflow execute 分离；有 baseline、串行保存、版本冲突停止与离开保护 | 单节点生成尚未消费可靠的保存成功结果；账号切换未与离开保护形成完整顺序 |
| 模型与生成 | 有能力选择、参数构建器、通用生成状态机、统一任务轮询、失败退避及跨标签协调；网络重试复用 request_id | features 白名单仍有过渡透传，视频询价与最终 create 仍分叉 |
| 认证与内容安全 | CookieRef／续期状态已按 Nuxt 实例隔离；有会话取消、续期超时；主要富文本展示入口统一清洗 | OSS 凭证缓存仍未绑定身份；真实后端权限、会话和 STS 策略待验收 |
| 媒体代理 | 已检查 DNS 地址、固定连接 IP、拒绝重定向、限制总时限和实际字节数，保留流背压 | 对外匿名代理仍需来源授权和按调用方限流，或证明网关已有等效防护 |
| 自动化 | 仓库有 813 个单元／集成测试文件、25 个正式 E2E 文件；配置 macOS／Windows 和三浏览器引擎矩阵 | 一处正式 E2E 与增量保存协议冲突未消除；缺当前候选版本完整放行证据 |
| 运行保障 | 保存、生成、协作故障有控制台和 IndexedDB 日志 | 部署监测、版本追踪、回滚和真实后端主链路尚未核验 |

旧审查中的 SSR 凭据单例、续期等待悬挂、仅 hostname 黑名单的媒体代理、主要富文本未清洗、保存失败无离开保护及冲突换版本强推，已在当前源码中看到对应修复。这些旧结论不作为当前未修复问题重复计数。当前持久化加载明确不恢复旧本地草稿，不能继续依赖 README 的草稿描述推断跨刷新恢复能力；这项产品能力可后续安排。

**P1-01：单节点生成没有可靠的保存成功前置条件。源码已确认。**

[createFlowNodeGeneration.ts](/Users/mac/AImanju/utils/flow/createFlowNodeGeneration.ts:221) 等待 `flushWorkflowSave()` 后，只检查节点、项目与画布 ID，随后创建任务。实际传入的保存入口直通 `persistence.flushSave()`；[useWorkflowPersistence.ts](/Users/mac/AImanju/composables/workflow/useWorkflowPersistence.ts:169) 在冲突状态下直接返回，保存失败也只设置 `status/saveError` 并正常结束。节点生成没有再次检查这些状态。

触发条件：已有服务端 ID 的节点修改后，batch 返回 500 或版本冲突，再点击生成。按当前调用链，已有 ID 检查仍可通过，生成请求仍可能发出。若后端接受，可能出现画布未保存但任务已创建并扣费；冲突状态又会阻止后续任务信息的 batch 保存。新节点缺少 ID 的检查不能保护已有节点。

最小修复：提供明确的节点／连线保存结果或“确保保存成功”入口，单节点生成在失败、冲突和尚未保存时停止创建；不必把无关视口保存强行并入生成条件。整条 workflow 的 [执行入口](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchExecutionSubmit.ts:28) 已有失败拦截，可复用其处理原则。

验收：使用真实持久化实现接测试 transport，覆盖 batch 500、409、超时及保存期间追加编辑；失败时 create 调用次数为 0，当前内容保留，恢复成功后只创建一次任务。本轮未运行该复现。

**P1-02：账号切换先改变服务端身份，之后才进入可取消的画布离开流程。源码已确认。**

[UserSwitchAccountDialog.vue](/Users/mac/AImanju/components/User/UserSwitchAccountDialog.vue:125) 先调用 `/account/change`、刷新用户与积分，然后调用但不等待 `router.push()`，立即将切换标记为成功。画布的 [路由守卫](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchLifecycle.ts:39) 此时才尝试保存，并允许用户因失败／冲突而取消离开。[协作切换监听](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchCollaboration.ts:2989) 只在 `aborted` 时恢复连接。

触发条件：在有未保存内容或版本冲突的画布中切换个人／团队账号；服务端切换成功后，离开确认选择取消。旧画布可以继续留在页面，而用户与积分已经切换，协作按成功离开的假设保持断开。保存也可能在服务端身份切换后才提交。这里确认的是前端流程顺序缺口，是否能越权写入仍取决于后端鉴权，不能据此宣称已发生越权。

最小修复：在调用账号切换接口前，以原身份完成保存或明确的放弃决定；冻结旧会话的待发送操作；等待导航结果并处理取消／失败，不在导航尚未完成时宣告整条流程成功。

验收：有 dirty、batch 在途、冲突和保存失败时分别切账号，覆盖取消与确认离开；取消不能留下新身份操作旧画布的状态，成功后不再发送旧身份的保存与协作消息。

**P1-03：模型能力约束及 credit/create 最终请求仍未统一。源码已确认，影响相应开放功能。**

[nodeGenerationConfig.ts](/Users/mac/AImanju/utils/flow/nodeGenerationConfig.ts:141) 的 `clampModelFeatures()` 未传白名单就原样保留 features；图片、文本、音频、脚本和视频配置中仍有无白名单调用，持久化构建器也没有传入白名单。切换到不支持某 feature 的模型时，旧字段无法在这一层得到可靠清除。

更直接的例子是视频风格：[flowNodeCredit.ts](/Users/mac/AImanju/utils/flow/flowNodeCredit.ts:920) 对已选风格追加 `style_id/support_models`，视频 UI 也有选择入口；[credit 出口](/Users/mac/AImanju/api/node/index.ts:82) 保留 features，而 [create 出口](/Users/mac/AImanju/api/task-generation/index.ts:30) 仅保留 `generate_mode`，批量任务另保留关联 id。因而相同节点的最终 HTTP 请求体已经不同。是否实际影响价格或效果需与后端确认，前端协议不一致本身已确定。

现有 [一致性用例](/Users/mac/AImanju/utils/flow/nodeGenerationConsistency.test.ts:128) 主要比较共同 Builder 与 batch 配置，没有经过两个最终 HTTP 出口，因此不能证明出口仍然一致。

最小修复：根据实际 capability 在共同归一层决定 parameters/features；询价、创建和保存从同一结果派生。如果后端不支持视频风格标识，则 UI、询价和创建应一起收敛；若支持，则共同保留。只处理本次开放的模型／模式，无需为未来能力扩大范围。

验收：直接捕获最终 HTTP body；覆盖视频选风格、不同 mode_type、切到不支持 feature 的模型、历史未知字段和非法值，而不仅比较中间 Builder。

**P1-04：OSS 临时凭证缓存没有与登录用户绑定。源码已确认；具体服务端影响待验收。**

[ossUpload.ts](/Users/mac/AImanju/utils/media/ossUpload.ts:114) 只按过期时间复用模块级 `ossStsCache`。当前清理入口只用于上传凭证过期重试；[退出登录](/Users/mac/AImanju/composables/auth/useAuth.ts:98) 清理 Cookie、用户资料与持久化缓存，没有清理这一内存凭证。游客白名单页退出不会强制刷新页面，之后可在同一应用中登录另一个用户。[上传构建](/Users/mac/AImanju/utils/media/ossUpload.ts:198) 却从当前用户资料生成 object key。

触发条件：A 上传取得尚未过期的 STS → 返回首页退出 → B 在同一页面登录 → B 上传。当前实现会复用 A 的 STS，同时用 B 的 uuid 构建路径。若 STS 按用户目录限制，可能出现 403；若权限更宽，凭证使用边界也不能由当前前端保证。没有核验后端 STS policy，不宣称跨账号访问已经成功。

最小修复：缓存绑定用户／账号和会话代数；退出、登录身份变化时清理；在途上传和登记不得跨会话继续写回。后端仍必须限制 bucket、路径和允许的操作。

验收：连续切换两个独立用户和个人／团队身份，记录 STS 获取次数及 object key；旧会话上传返回后不得登记到新账号。

**P1-05：媒体代理对外开放时仍缺调用方的资源使用边界。需要部署防护证据或补实现。**

[download-proxy.get.ts](/Users/mac/AImanju/server/api/media/download-proxy.get.ts:23) 接收 URL 后直接转发，仓库没有服务端认证／签名校验中间件或按调用方限流。当前通用代理允许公网 HTTP(S) 目标；视频单次最大 256 MiB，同一 Nitro 进程最多同时拉取 16 个媒体，总时限 60 秒。已有硬上限能限制单次资源占用，但不能限制同一来源反复占满所有槽位，也不能控制匿名调用的总带宽。

若这些接口可直接从公网访问且网关无额外约束，第三方可占用下载资源并让正常用户得到 503。需要采用符合业务的可信来源、短期签名资源 URL、每调用方限流／带宽预算，或验收网关已有的等效策略。公开分享页面需要保留合法游客读取路径，不应简单依靠前端登录守卫。

当前 DNS/IP 与重定向防护应保留，不重复认定旧的内网 SSRF 缺陷仍未修复。边界判断参考 [OWASP SSRF 防护](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)；按调用方限频和费用控制属于 [OWASP API 资源消耗防护](https://owasp.github.io/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)建议。是否缺部署侧防护，本轮未核验。

**P1-06：正式 E2E 仍有协议断言冲突，当前候选版本完整发布门禁没有得到证明。**

[text-rich-editor.e2e.ts](/Users/mac/AImanju/tests/e2e/text-rich-editor.e2e.ts:88) 要求组内节点纯正文修改的 update 携带原 `parent_uuid`；[workflowNodeSave.ts](/Users/mac/AImanju/utils/workflow/workflowNodeSave.ts:369) 在父组不变时明确省略它。既有灰度复查记录已报告该断言失败，当前源码仍保留这个冲突。本轮没有重跑，不能给出新的失败数量，也不能据此断言线上真的丢组。

应先确认后端增量更新的契约，再保留“保存前后／重开后组归属、正文、位置、尺寸、连线和保存次数正确”的行为保护。若需要调整断言语义，遵守仓库 §0.1 的维护者确认要求；本轮不修改或跳过该测试。

[CI 配置](/Users/mac/AImanju/.github/workflows/test.yml:141) 有汇总 quality-gate，本地 `.githooks` 也已配置。远端指向自建 Git 服务，尚未取得实际工作流执行、runner 能力或必需状态配置的证据。[Playwright 默认配置](/Users/mac/AImanju/playwright.config.ts:39) 启动 dev server，画布 fixture 使用 API/WS 测试桩。这些测试不能替代生产构建与真实后端的验收。

**发布证据与环境待验收项**

读取本机已有产物得到以下事实，均不是本轮重新执行的结果：

| 证据 | 读取到的内容 | 能证明的范围 |
| --- | --- | --- |
| `test-results/test-results.json` | 2026-09-22 13:26:38 +08:00，`success=true`，7,148 个用例通过、0 失败 | 存在一次本地 Vitest 成功记录；文件没有绑定 Git SHA，不能单独证明完整发布门禁 |
| `coverage/coverage-final.json` | 修改时间为 12:09:24 +08:00 | 存在历史覆盖率产物；未重新计算当前版本覆盖率 |
| `.output/nitro.json` | 构建时间 12:04:29 +08:00，`node-server` preset | 已有构建早于当前提交 13:23:17，不能将该产物直接视为当前源码的候选构建 |
| 旧复查报告 | 记录了部分 Firefox／Chromium 冒烟与安全验证，以及未完成的组内文本验收 | 历史部分验证，不能代替全量 E2E、真实 Safari 或 Windows 实测 |

正式发布前需要把同一提交、构建、CDN 资源和验收记录绑定起来：

1. 按项目规则通过提交门禁及实际 CI，取得 typecheck、单元／集成、覆盖率、生产构建和正式 E2E 的结果；在真实托管平台确认 quality-gate 是必需状态。本轮没有暂存或提交，因此没有运行 `npm run check:commit`。
2. 部署新的 Nitro 候选产物，确认 `/api/media/*` 可用，API、WS、HTTPS 和 CDN 资源匹配。当前 CDN 配置为 `/v1.0.3/`，package 版本为 `1.0.0`，应确认发布侧 `NUXT_PUBLIC_APP_VERSION`、资源目录及后端版本提示的约定，不能单凭二者不同推断部署已故障。Node 入口见 [Nuxt 官方部署说明](https://nuxt.com/docs/3.x/getting-started/deployment)。
3. 用真实后端跑通登录／续期 → 上传 → 开放模型询价与生成 → 保存 → 刷新／重开；验证创建成功但响应超时后的重复操作不会重复扣费，取消任务与退款符合既有后端规则。
4. 用两个独立账号验证项目、节点、素材、分享、下载和团队角色权限，以及 STS 目录约束；验证两标签／两客户端的版本冲突、断线重连及锁租约。前端隐藏入口或 query 中的只读标记不能作为后端鉴权证据。
5. 根据实际预期用户量，验证大画布编辑、并发生成轮询、媒体代理带宽与内存；当前没有压测数据，不能给出支持多少并发用户的结论。
6. 确定可恢复的上一版本、发布负责人和基本故障定位路径。当前 [canvasObservability.ts](/Users/mac/AImanju/utils/flow/canvasObservability.ts:15) 只记录控制台与本机 IndexedDB；公网正式开放前至少应能集中获得关键保存／生成／登录失败、版本和脱敏关联标识，或提供已运行的等效运维方案。小范围灰度可先使用明确的人工反馈和日志流程，无需为本次新建完整监控平台。
7. 兼容性按仓库要求优先真实 macOS Safari，其次 Firefox，再 Chrome／Edge，以及 Windows Firefox／Chrome／Edge；覆盖中文输入、快捷键、剪贴板、上传下载、媒体播放、画布拖拽和保存重开。本轮全部未实测，WebKit 自动化也不能替代真实 Safari。

**可放到上线后的维护工作**

`useFlowWorkbenchState.ts` 3,677 行、`useFlowWorkbenchCollaboration.ts` 3,130 行，多个节点 orchestrator 超过 2,000 行；用户与通用 API 仍有宽泛 `any`。这些会增加修改和定位成本，但文件体量、局部类型债务不是要求上线前整体重构的理由。后续按职责逐步拆分，并保持现有行为回归。草稿恢复、离线编辑、自动冲突合并也不因本次架构审查自动成为必做功能。

本轮实际执行 `git status/log/rev-parse/config`、`rg`、`cat`、`nl`、`sed` 及 Python 只读文件统计／JSON 读取，定位了上述问题；另查阅 Nuxt 和 OWASP 官方资料。未执行 `npm run check:ai`、`npm run check:commit`、`npm run typecheck`、Vitest、Playwright、覆盖率、构建、性能测试或依赖漏洞审计。没有修改校验开关，不能把未执行或历史部分通过写成当前正式放行。
