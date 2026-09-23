AImanju 公开付费生产上线审查 · 2026-09-22

**结论：架构主干具备继续上线的基础，但当前候选版本尚不建议正式放行给公开付费用户。需要先补齐批量生成的保存门禁、生成重试幂等与支付状态恢复，再取得真实后端、生产构建和运维验收证据。现有证据不支持上线前更换框架或整体重构。**

审查对象为 `/Users/mac/AImanju`，分支 `feature/tiptap-editor-migration`，HEAD `a586fa11`，包含审查开始时已有的 6 个未提交文件：媒体代理说明与实现/测试、图片媒体池实现/测试、回归契约。本轮保留这些修改，只新增本报告到已被 Git 忽略的 `docs/`。

用户确认上线范围为“公开生产环境，含付费用户”。本轮沿应用配置、认证/HTTP、画布保存/协作、生成/积分、订单支付、OSS、媒体代理、富文本与发布门禁追踪主要调用链，并阅读关联测试与历史修复记录。未逐行审计全部源码；当前仓库不包含业务后端和生产基础设施，未访问生产服务或远端 CI。下文将源码确认的问题、条件性风险和缺失的验收证据分开说明。

**架构判断**

| 维度 | 已有基础 | 当前判断 |
| --- | --- | --- |
| 应用分层 | Nuxt/Vue/TypeScript；页面、组件、composable、工具、API 分离；画布 CSR，其余页面保留 SSR | 可以保留。部署须包含承载媒体代理的 Nitro/Node 服务 |
| 画布状态 | 业务节点、Vue Flow runtime、坐标同步、事务与脏追踪分层 | 主干合理。大画布容量与真实设备表现仍需验收 |
| 保存一致性 | batch 与视口通道独立；串行保存、跟进保存、expected_version、冲突停止与离开保护 | 已有保护，但整组/多选生成未消费严格的保存成功条件 |
| 生成架构 | 能力 Schema、共同 Builder、普通节点生成状态机、任务中心、轮询退避和任务日志 | 方向正确，部分批量/资产入口仍绕开统一提交保障 |
| 身份与上传 | Nuxt 实例隔离认证会话、续期互斥和取消；STS 缓存绑定会话及账号 | 当前源码已体现近期修复；后端权限和 OSS policy 未验证 |
| 媒体与内容 | 主要富文本入口清洗；代理有精确来源白名单、DNS/IP 防护、背压、大小/时限/调用方预算 | 可继续使用。外链打开工具仍需收紧；真实代理链与多实例预算待验证 |
| 工程门禁 | 817 个单元/集成测试文件、25 个正式 E2E 文件；提交门禁及跨系统浏览器矩阵 | 有较完整的测试基础，文件数量不等于当前版本验收通过 |
| 运行保障 | 故障事件写入浏览器控制台和 IndexedDB | 仓库内未形成集中告警、候选产物验收和回滚证据闭环 |

源码依据：[Nuxt 配置](/Users/mac/AImanju/nuxt.config.ts:29)、[认证会话](/Users/mac/AImanju/composables/auth/authCookieRefs.ts:15)、[OSS 身份隔离](/Users/mac/AImanju/utils/media/ossUpload.ts:42)、[模型 feature 归一](/Users/mac/AImanju/utils/flow/modelFeaturePolicy.ts:63)、[任务中心](/Users/mac/AImanju/composables/flow/workbench/useFlowGenerationTaskCoordinator.ts:1074)。

**P1-01：整组执行/多选批量生成仍可越过保存失败与版本冲突。源码调用链确认。**

[useFlowWorkbenchGroupRun.ts](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchGroupRun.ts:244) 在提交前调用普通 `flushWorkflowSave(reason)`，没有传 `{ requireSaved: true }`。调用方传入的是 [持久化原入口](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchOrchestrator.ts:532)，没有包装严格检查。

普通 [flushSave](/Users/mac/AImanju/composables/workflow/useWorkflowPersistence.ts:393) 在未要求 `requireSaved` 时直接结束；保存失败在状态中表达，冲突时停止保存但不抛异常。因此调用方的 try/catch 不能证明保存成功。其 [isGenerationShortcutBlocked](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchOrchestrator.ts:252) 仅检查编辑失效、hydration 与只读，不检查保存失败/冲突。满足其它条件后会继续 [batch_create](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchGroupRun.ts:322)。

触发条件：已有服务端 ID 的节点修改后，保存接口返回 500 或 409，用户选择整组执行或多选批量生成。前端仍可能发送创建请求；若后端接受，会产生未保存配置与付费任务不一致，冲突时也无法正常回写任务状态。

现有 [组执行测试](/Users/mac/AImanju/composables/flow/workbench/useFlowWorkbenchGroupRun.test.ts:292) 把保存函数 mock 成 reject，不能覆盖真实保存函数“记录 error 后 resolve”的行为。普通单节点已在 [createFlowNodeGeneration](/Users/mac/AImanju/utils/flow/createFlowNodeGeneration.ts:224) 接入严格保存，这项发现针对尚未覆盖的批量入口，不重复认定单节点修复无效。

最小修复：批量入口复用严格节点/连线保存前置，保持视口通道独立；所有付费任务入口统一消费保存结果。验收使用真实持久化实现接可控 transport，分别覆盖 500、409、超时及保存途中追加编辑，确认 batch_create 调用数为 0，恢复并保存成功后才允许提交。

**P1-02：生成幂等保护没有覆盖全部入口。前端缺口确认，实际重复扣费取决于后端。**

普通单节点在 [createFlowNodeGeneration.ts](/Users/mac/AImanju/utils/flow/createFlowNodeGeneration.ts:261) 中保留同一请求指纹的 pending request_id，网络失败后可复用，这是已有正确行为。但下列路径没有同等保护：

- [批量请求类型](/Users/mac/AImanju/api/task-generation/types.ts:94) 仅包含 drama_id、node_id、tasks；[批量 API](/Users/mac/AImanju/api/task-generation/index.ts:70) 也未补充稳定的幂等标识。整组、资产批量、分镜提示词批量均直接调用该接口。
- [资产选图生成](/Users/mac/AImanju/components/flow/script/ScriptWorkflowAssetPickImageDialog.vue:650) 每次点击都生成新 request_id；[网络失败后](/Users/mac/AImanju/components/flow/script/ScriptWorkflowAssetPickImageDialog.vue:705) 恢复可提交状态，没有保存该次请求 ID 供重试。
- 普通节点的 pending ID 是生成实例闭包状态，不能仅凭它认定跨刷新/重新挂载重试已经获得完整保护；已取得 task_id 的任务恢复机制不能证明“已创建但 create 响应丢失”同样被覆盖。

触发条件：服务端已接受并扣费，响应在途中丢失或超过前端 45 秒超时，用户再试。前端可能发送无幂等键或新幂等键的请求；如果后端没有其它去重/查询机制，就可能重复创建和扣费。这里没有证据证明线上已经重复扣费，也不能根据前端 ID 的存在证明后端正确去重。

最小修复：与后端确认真实支持的幂等协议，将创建意图与请求 ID 的生命周期统一到提交协调层；同一次结果未确认的操作复用标识并可查询结果，明确失败或用户发起新操作才换标识。批量接口也需与后端对齐，不能只由前端擅自添加字段。验收必须检查“服务端成功、客户端丢响应、重试/重开”后只存在一份任务和一笔扣费。

**P1-03：支付状态轮询遇到一次网络异常后停止，且缺少订单切换的迟到响应保护。源码控制流确认。**

[useSubscribeOrderPayPoll.ts](/Users/mac/AImanju/composables/payment/useSubscribeOrderPayPoll.ts:35) 的 `pollOnce()` 只有 try/finally，没有 catch；下一次定时器位于 finally 之后。`getOrderInfo` 抛出网络异常时，finally 仅将 polling 设为 false，函数随后以 rejection 退出，不会走到调度代码。active 和 tradeId 不变时，watch 也不会重新启动轮询。

该 composable 被积分充值、个人/团队会员、扩容与席位购买复用，例如 [充值成功处理](/Users/mac/AImanju/components/User/UserPointsRechargeDialog.vue:86)。因此一次临时断网就可能使付款后页面持续等待，余额或权益 UI 未及时更新。该问题不表示服务端未到账。

同一入口还在 await 之后直接调用 onPaid，没有核对请求开始时的订单号和当前 active/订单号；用户关闭、重开或切换订单时，旧订单的迟到成功响应可能更新新弹窗。卸载目前只清理 timer，没有作废在途请求的回调。

最小修复：以订单号和会话代数限定轮询；网络错误进入有上限的退避重试，关闭/卸载/换订单后取消或忽略旧结果，paid 只回调一次。验收覆盖一次请求拒绝后恢复、等待响应期间换订单、关闭弹窗和成功响应重复返回。

**安全条件项 S-01：外链工具将远端 URL 拼入可执行 HTML，应在公网开放前收紧。危险入口确认，可利用性未实测。**

[openUrlInNewWindow.ts](/Users/mac/AImanju/utils/ui/openUrlInNewWindow.ts:22) 将 `JSON.stringify(url)` 拼进 `<script>location.replace(...)</script>`，再调用 document.write。JSON 字符串转义不能替代 HTML script 上下文隔离，函数也没有限制 URL 协议。当前在用的入口包括 [首页 Banner 外链](/Users/mac/AImanju/components/Home/HomeBannerCarousel.vue:469) 和 [协议外链](/Users/mac/AImanju/utils/home/homeAgreement.ts:30)，来源是后端配置。

如果这类字段可被写入恶意内容，便存在脚本注入/危险协议导航风险。没有检查后台字段写权限、上游过滤或线上 CSP，因此本轮不将它描述为“任意普通用户已经可以攻击”。MDN 明确说明 [document.write 会将输入解析为 HTML，属于潜在注入入口](https://developer.mozilla.org/en-US/docs/Web/API/Document/write)。

最小修复：统一解析 URL 并只接受业务允许的协议；固定页面样式用 DOM 属性设置，跳转调用 location API，不把动态 URL 拼进 HTML/script 字符串。此方案无需依赖仅部分浏览器支持的 Trusted Types。

认证 Cookie 当前 [可由客户端读取且未显式设置 Secure](/Users/mac/AImanju/plugins/auth-cookies.ts:5)；[协作 token 放在 WS query](/Users/mac/AImanju/composables/workflow/collaboration/resolveCanvasCollaborationWebSocketUrl.ts:14)。公开部署需确认 HTTPS、cookie 策略与网关日志脱敏，后续可由服务端管理 refresh token 或提供短期 WS ticket。OWASP 提醒 [query token 可能进入访问日志，应脱敏](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)。本轮未验证线上日志中存在泄露，不据此宣称已经发生会话泄露。

**正式放行还缺少的证据**

| 项目 | 仓库内看到的事实 | 放行所需证据 |
| --- | --- | --- |
| 集中监控 | [canvasObservability](/Users/mac/AImanju/utils/flow/canvasObservability.ts:29) 只写 console 和本机 IndexedDB，后者最多保留 500 条 | 保存失败、生成结果不确定、支付查询失败、协作断连等事件能集中定位到脱敏关联 ID 和发布版本，并有告警接收人；也可提供已部署的等效方案 |
| 当前候选门禁 | 有 [.github 工作流](/Users/mac/AImanju/.github/workflows/test.yml:141)，本机 core.hooksPath 为 .githooks；origin 是自建 Git 服务 | 实际托管平台运行当前候选提交的记录及必需状态；不能从 YAML 或本地钩子推断远端分支保护已经生效 |
| 生产产物验收 | [Playwright](/Users/mac/AImanju/playwright.config.ts:39) 启动 npm run dev；主要画布 fixture [替换业务 API，未匹配接口返回空成功](/Users/mac/AImanju/tests/e2e/support/canvasExtended.fixture.ts:1231) | 保留这些前端回归，同时用生产构建产物连接预发布真实后端跑通登录→上传→询价→生成→保存→重开；支付使用测试商户/验收账户验证到账与权益 |
| 后端与账务 | 本仓库仅有调用协议，没有支付回调、账本、任务队列与完整权限实现 | 验签、订单金额/归属、回调幂等、扣费与任务原子性、失败退款/补偿、租户与资源权限、STS 目录限制的实现与验收记录 |
| 协作正确性 | 前端有版本处理、重连和详情重同步 | 两账号/两标签并发修改、409、丢消息、重连、锁租约到期与退出账号后权限失效的真实后端验收 |
| 媒体容量 | 每 IP 4 在途，进程全局 16 在途；可信代理默认空；预算为进程内 | 真实反向代理地址配置、客户端 IP 归属、主要媒体来源完整白名单、多实例网关聚合限流以及峰值内存/带宽数据。见 [部署说明](/Users/mac/AImanju/server/utils/media/README.md:14) |
| 发布与恢复 | 仓库未提供可核验的生产发布/回滚及数据恢复记录 | API/WS/Nitro/CDN 版本一致，候选产物可回滚；数据库与对象存储备份及恢复演练由后端/运维提供 |
| 性能与兼容 | 有画布性能契约与 macOS/Windows 浏览器矩阵 | 目标规模的大画布、并发生成、下载和长时间编辑实测；优先真实 Safari，其次 Firefox，覆盖 Chrome/Edge 与对应系统交互 |

以上“缺证据”不等于服务端一定没有实现。在提供并核对这些证据前，无法给出整个产品已达到公开付费生产标准、支持特定并发数或所有浏览器兼容通过的结论。

**需要明确接受的产品边界与后续维护项**

当前 [持久化层明确不读写浏览器草稿](/Users/mac/AImanju/composables/workflow/useWorkflowPersistence.ts:89)，[加载时不恢复旧草稿](/Users/mac/AImanju/composables/workflow/useWorkflowPersistence.ts:373)。保存失败/版本冲突后，只能留在当前页面重试或人工复制内容；页面崩溃、强制终止时未保存编辑无法依赖本地草稿恢复。现有离开确认和 visibilitychange 尽力保存仍有价值，但 [beforeunload 并非始终触发](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)。

这是当前实现的产品边界，不把“完整离线编辑/自动合并”自动扩成上线前必做功能。公开付费上线应明确同步失败的提示、恢复/导出策略和支持流程；README 所述“写本地草稿”需要与真实实现对齐。若产品承诺异常退出后恢复，则该承诺对应的持久恢复能力需要先补齐。

`useFlowWorkbenchState.ts` 为 3,677 行，`useFlowWorkbenchCollaboration.ts` 为 3,130 行，多个节点 orchestrator 超过 2,000 行；通用 API/UserInfo 也仍有宽泛 any。后续适合按状态、协议和 UI 编排逐步拆分，收窄边界类型。这些维护成本本身不构成上线前大重构的理由。当前更优先的架构调整是：让普通、批量和资产生成共用提交保障，避免同一安全条件只在部分入口生效。

**建议的交付顺序与验收界限**

1. 修复 P1-01～03，并处理 S-01 外链工具；保留节点/连线、视口和执行三条独立通道，以及 Schema 驱动参数和后端协议。
2. 由维护者决定现有 6 个工作区修改中哪些纳入发布，整理暂存内容并固定候选提交，通过 npm run check:commit，再取得同一候选版本的实际 CI、覆盖率、生产构建和正式 E2E 结果。
3. 使用该生产产物完成真实后端付费主链路、权限、协作、代理链、监控与恢复验收。针对失败恢复场景主动丢响应/模拟断网，不能只检查顺畅路径。
4. 在有明确监控和可回滚产物的条件下逐步扩大流量；容量上限以实际测试结果设定，不从前端代码推算用户并发承诺。

本轮开始及生成报告前读取 ai-check.config.json，均为 `regressionEnabled=false`，未修改开关。实际执行 git status/log/ls-files/rev-parse/config、rg、cat、nl、sed 与 Python 只读统计/配置读取，结果用于上述静态定位；另查阅 MDN、OWASP 官方说明。未执行 check:ai、check:commit、typecheck、Vitest、Playwright、覆盖率、构建、依赖审计或压测，没有修改业务源码、测试、暂存区或提交代码。

历史修复记录中的提交门禁通过结果仅属于当时的版本，不能替代本轮含工作区修改的候选验收。本轮真实 Safari、Firefox、Chrome/Edge、WebKit/Firefox/Chromium 自动化，以及 Windows/macOS 运行验证均未执行；表中的验收场景就是待验证范围。
