# AImanju Node.js 后端项目生成规格

> 编写日期：2026-09-23。目标：把本仓库的 Nuxt 3 前端接入一个新建的、可独立部署的 Node.js 业务后端。本文可直接交给有本仓库读取权限的编码 AI 作为实施任务。路径与字段以当前源码为准；文末的接口清单是静态调用清单，不代表这些接口已有服务端实现。

## 0. 给编码 AI 的执行指令

请先完整阅读本文件，再阅读文中指向的前端源码与类型。创建一个可运行的 `aimanju-backend` 项目；如果与前端共用仓库，放在独立的 `backend/` 目录，不覆盖 Nuxt 源码。以本文的「已确认契约」保证现有前端能直接调用。对于标为「待确认」的字段和外部服务，保留清晰的适配层、配置项与文档，不编造真实支付、短信、微信、OSS 或模型厂商的成功结果。

实施时按以下顺序交付，每一步都产出可运行代码、数据库迁移、OpenAPI、测试和运行说明：

1. 基础工程、数据库、统一响应、鉴权与账号隔离。
2. 短剧/画布、节点/连线 batch、详情和个人视口。
3. 模型能力、询价、单次/批量生成、积分账本、任务 worker。
4. 原生 WebSocket 协作、锁、事件重同步。
5. OSS/媒体、脚本、素材、主体、作品、团队、订单等其余接口。
6. 与真实前端联调，修复契约差异并提交逐接口验收记录。

完成标准是：后端在空数据库上可通过迁移和种子数据启动；没有真实第三方凭证时本地可用明确的 **开发模拟适配器** 跑通测试；生产配置缺失时涉及收费或外部调用的接口返回明确错误，不能伪造任务完成或支付成功；核心路径有集成测试；现有前端无需改动核心 HTTP/WS 协议即可联调。若本文件与源码冲突，先记录冲突、以当前前端实际 HTTP 出口和类型为准，再修订 OpenAPI 和实现。

## 1. 事实边界与来源优先级

### 1.1 本仓库现状

- 框架：Nuxt 3、Vue 3、TypeScript。业务 API 主要封装在 [`api/`](../../api/)，统一请求入口是 [`utils/http/request.ts`](../../utils/http/request.ts)，运行基址来自 [`nuxt.config.ts`](../../nuxt.config.ts)。
- 仓库只有前端和少量 Nitro 媒体代理路由；没有完整的业务后端、数据库 schema、支付回调、任务队列或模型厂商密钥。Nitro 的 [`server/api/media/`](../../server/api/media/) 继续承担现有媒体代理职责。
- `README.md` 描述「本地草稿」，但当前 [`useWorkflowPersistence.ts`](../../composables/workflow/useWorkflowPersistence.ts) 明确不读写浏览器草稿。新后端应按 **当前保存 HTTP 契约** 实现，不以 README 的草稿描述推断离线同步能力。
- 部分前端 API 仍使用 `any` 或宽松兼容类型。本文对其列出路径与用途，具体 DTO 必须从调用点、页面表单和联调结果收敛，不得把推测值伪装为已确认协议。

### 1.2 术语

| 标记 | 含义 |
| --- | --- |
| **已确认契约** | 当前前端发送/解析的字段或项目规则；后端须兼容。 |
| **建议实现** | 为生成新后端给出的技术和数据设计，允许在不改变外部契约前提下优化。 |
| **待确认** | 前端未给出完整协议，或需要外部平台/运营决定；先列出决策点。 |

优先级：实际 API 调用与类型 → 相关行为测试 → 当前 `AGENTS.md` 的协议约束 → README/设计说明 → 本文建议。旧的逆向资料和上线审查报告可用来发现问题，不能直接当作当前服务端事实。

### 1.3 关键源码索引

| 领域 | 必读源码 |
| --- | --- |
| HTTP、认证 | [`utils/http/request.ts`](../../utils/http/request.ts)、[`api/login/index.ts`](../../api/login/index.ts)、[`composables/auth/useAuth.ts`](../../composables/auth/useAuth.ts) |
| 画布详情与批量 | [`api/project/types.ts`](../../api/project/types.ts)、[`api/node/types.ts`](../../api/node/types.ts)、[`utils/workflow/workflowNodeSave.ts`](../../utils/workflow/workflowNodeSave.ts)、[`composables/workflow/persistence/workflowRemoteBatchAdapter.ts`](../../composables/workflow/persistence/workflowRemoteBatchAdapter.ts) |
| 生成与能力 | [`api/task-generation/types.ts`](../../api/task-generation/types.ts)、[`api/node/types.ts`](../../api/node/types.ts)、[`utils/flow/nodeGenerationConfig.ts`](../../utils/flow/nodeGenerationConfig.ts)、[`api/task-generation/README.md`](../../api/task-generation/README.md) |
| 协作 | [`types/flow/canvasCollaboration.ts`](../../types/flow/canvasCollaboration.ts)、[`api/group/index.ts`](../../api/group/index.ts)、[`composables/workflow/collaboration/useCanvasCollaborationTransport.ts`](../../composables/workflow/collaboration/useCanvasCollaborationTransport.ts) |
| 订单与积分 | [`api/user/member.ts`](../../api/user/member.ts)、[`api/user/index.ts`](../../api/user/index.ts)、[`api/user/invoice.ts`](../../api/user/invoice.ts) |
| 上传与资源 | [`api/upload/types.ts`](../../api/upload/types.ts)、[`api/volc-asset/types.ts`](../../api/volc-asset/types.ts)、[`utils/media/ossUpload.ts`](../../utils/media/ossUpload.ts) |

## 2. 技术栈和进程边界

### 2.1 建议实现

| 用途 | 选型 | 具体要求 |
| --- | --- | --- |
| 运行时 | Node.js 22 LTS、TypeScript strict | 先与前端 `.nvmrc` 对齐；之后统一验证升级到更新 LTS。锁定依赖版本并提交锁文件。 |
| HTTP | NestJS + `@nestjs/platform-fastify` | 全局前缀 `/api`；业务模块、Guard、Pipe、Filter 分离；Fastify 插件使用 Fastify 版本。 |
| 数据 | PostgreSQL + Prisma Migrate | 关系表承载权限、账本、任务、图结构；`extra_data`/能力声明采用 JSONB。复杂 CAS/锁可用参数化 SQL。 |
| 队列 | Redis + BullMQ | API 负责受理，独立 worker 负责异步生成；Redis 队列不是业务幂等真源。 |
| 实时 | 原生 WebSocket + Nest `WsAdapter` 或独立 `ws` 网关 | 保持前端 `{type,data}` 消息形状；多实例使用 Redis 广播，持久图版本以 PostgreSQL 为准。 |
| 存储 | 当前 OSS + 服务端 STS | 浏览器直传，后端签发最小权限临时凭证并验证上传登记。 |
| 契约 | OpenAPI + 运行时 DTO 校验 | 生成的 OpenAPI 应覆盖每个已实现接口；不能仅靠 TS 接口做运行时校验。 |
| 可观测性 | 结构化日志、健康检查、trace/request ID | 脱敏 token、手机号、提示词和签名 URL；记录 `account_id`、`canvas_id`、`request_id`、`task_id`、`event_id` 关联。 |

官方依据：[Nest Fastify](https://docs.nestjs.com/techniques/performance)、[Nest 队列](https://docs.nestjs.com/techniques/queues)、[Nest WebSocket 适配](https://docs.nestjs.com/websockets/adapter)、[PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html)。这些文档说明可用组件；本文的组合是针对本项目的设计建议。

### 2.2 部署拓扑

```text
浏览器 Nuxt ── HTTPS /api/* ──> API 进程 ──> PostgreSQL
       │                           │       └──> Redis / BullMQ
       │                           └──> OSS STS、支付、短信/微信适配器
       ├── WSS 协作 ──────────────> WS 网关 ──> Redis 广播 + PostgreSQL 图版本
       └── /api/media/* ─────────> 现有 Nuxt Nitro 媒体代理
                                    Worker ──> AI Provider Adapter ──> 第三方模型
```

单机开发可在同一 Nest 代码库内运行 API/WS/worker 三个入口；生产环境至少把 worker 与 HTTP API 分成独立进程，避免媒体/模型任务阻塞请求。支付回调入口可以属于 API 进程，但必须独立验签与幂等。反向代理须支持 WebSocket upgrade、请求体大小限制和超时策略。

### 2.3 建议目录

```text
backend/
  src/
    main.ts                    # HTTP 入口
    worker.ts                  # BullMQ worker 入口
    common/                   # 响应、异常、鉴权上下文、校验、日志
    auth/ accounts/ teams/    # 登录、身份、团队、权限
    dramas/ canvases/ nodes/ connections/
    models/ generation/ credits/ workflows/
    collaboration/ assets/ uploads/ subjects/ materials/
    scripts/ voices/ styles/ scenes/
    plans/ orders/ invoices/ spaces/
    opus/ activities/ notifications/ home/
    providers/                # AI、短信、微信、OSS、支付的接口与适配器
  prisma/                     # schema、迁移、测试种子
  test/                       # API、DB、WS、worker、故障注入测试
  openapi/                    # 导出的正式接口文档
  docker-compose.yml          # 本地 PostgreSQL、Redis
  .env.example                # 只有变量名与安全示例，无密钥
```

## 3. 全局 HTTP 契约

### 3.1 地址、字段和响应

**已确认契约：**前端 `NUXT_PUBLIC_API_BASE` 示例末尾为 `/api`，调用时传 `/node/batch` 等相对路径，因此外部 URL 是 `/api/node/batch`。返回体通常为 `{"code":200,"message":"ok","data":...}`；`code === 200` 才算业务成功。现有字段使用 `snake_case`；新后端边界 DTO 沿用该风格，服务内部可用 camelCase。列表端点通常返回 `data.list`、`data.total`。ID 在历史类型中可为数字或数字字符串，建议输出正整数并在输入边界接受合法数字字符串。

```json
{ "code": 200, "message": "ok", "data": { "id": 1 } }
```

**错误约定：**返回可读 `message`，兼容 `msg` 的旧入口只作为读取兜底。HTTP 401 或业务 `code=401/402` 会触发前端失效处理。画布版本冲突使用 HTTP 409 或业务 `code=409/40900`，在 `data.current_version` 给出最新版本。生成 create 的业务 `code=412` 表示并发上限；`code=414` 表示火山素材已过期，前端随后会调用 `/volc-asset/check`。积分不足应返回明确中文 `message`，目前前端按文案识别，最终应与前端共同收敛专用业务码。服务端错误不得返回“成功但无任务 ID”来掩盖创建结果不确定。

### 3.2 身份、账号和权限

- 前端对普通 API 加 `Authorization: Bearer <access_token>`；`POST /api/auth/refresh` 的 Authorization 则放 **refresh token**，成功后读取 `data.access_token` 和可选 `data.refresh_token`。登录成功也要返回这两个字段。
- 所有资源读写用服务端认证身份确定 `user_id` 和当前 `account_id`。请求体里的 `account_id`、`drama_id`、`canvas_id`、`node_id` 只用于定位，绝不替代资源归属校验。
- 个人/团队账号切换会影响积分、项目、成员权限和 WS 房间。token/session 应绑定当前活跃账号或 session revision；切换后旧权限不可继续写入。每次创建任务、重试幂等请求、上传登记、下载和 WS 消息都重新查权限。
- 团队角色至少区分所有者/管理员/成员；项目级读、编辑、生成、删除、分享、账务权限由策略服务统一判断。前端隐藏控件和 `share=1` 查询参数都不是授权证据。
- 登录方式涉及密码、短信、微信。短信验证码限频、有效期和一次性消费；密码用适当的慢哈希；refresh token 服务端保存摘要、支持轮换和撤销。微信与短信网关需要真实平台配置，开发环境可以注入模拟适配器。
- CORS 允许明确的前端 Origin；生产必须 HTTPS/WSS；WS query 中现有 token 应在网关日志中脱敏，并设置短有效期、握手鉴权、Origin 校验与断开时权限回收。升级到短期 WS ticket 需要前端配合，不能仅改后端。

当前登录页面还能确定以下请求字段（见 [`LoginAccount.vue`](../../components/Login/LoginAccount.vue)、[`LoginSms.vue`](../../components/Login/LoginSms.vue)）：

| 路由 | 当前前端发送 | 最低成功响应 |
| --- | --- | --- |
| `POST /login/password` | `{username,password}`；username 可填手机号/用户名/邮箱 | `data.access_token`、`data.refresh_token`。账号登录入口当前 UI 可隐藏，但 API 仍存在。 |
| `POST /sms/send` | `{mobile,sendType}`，`sendType=login_register` 或 `bind_phone` | `code=200` 后前端开启冷却计时；服务端仍需独立限频。 |
| `POST /login/sms` | `{mobile,captcha}` | 两个 token。 |
| `POST /login/wechat` | `{code}` | 两个 token；`data.bind_phone=false` 时前端提示绑定手机号。 |
| `POST /user/bindPhone` | `{mobile,captcha}`，需已登录 | 成功业务响应；关联当前用户，手机号唯一。 |
| `POST /auth/refresh` | `Authorization: Bearer <refresh_token>`，无必需 body | `data.access_token` 与可选轮换后的 `data.refresh_token`。 |

`GET /api/user/info` 的主要 `data` 字段为 `account_id,account_name,account_type,avatar,is_vip,vip_level,plan_expire,plan_title,role_name,uuid`，详见 [`api/user/index.ts`](../../api/user/index.ts)。前端登录成功后会并行拉取用户信息、积分和首页初始化配置；这三个 GET 需在新登录 token 下立即可用。账号切换 `POST /account/change` 的 body 仍是宽泛类型，须从页面调用点与实际业务决定。

### 3.3 输入、时间、分页与安全

- 对所有请求做运行时校验、长度/数量/大小限制、资源归属校验。对 `parameters`、`features`、`extra_data` 用白名单和大小上限；不能把任意客户端字段直接传给模型厂商或存为管理员配置。
- 金额用整数分；积分用整数或精确数值类型，按现有产品规则确定，不使用 JS 浮点数作账本余额真源。所有价格从服务端配置计算，客户端报价仅供展示。
- 数据库时间统一 UTC；HTTP 中已明确的字段按当前格式输出，如画布 `updated_at` 为数字、订单 `expire_time` 为 10 位秒级时间戳。其它 `create_time` 字符串格式在联调时固定并纳入 OpenAPI。
- 分页统一验证 `page >= 1`、`limit` 上限、稳定排序和租户条件；不因前端未传上限而无限查询。
- 用户可输入的 URL 只允许业务允许的协议和来源。服务端抓取媒体时防 SSRF、重定向绕过和内网地址访问；OSS 对象 key 和签名 URL 不直接信任客户端。日志和错误体不回显密钥。

## 4. 数据模型与事务边界

### 4.1 建议的主表

表名是建议实现；外部 HTTP 字段名由第 3、5 节决定。所有业务表设 `created_at`、`updated_at`，删除与审计策略按表区分。

| 表 | 关键字段/约束 | 用途 |
| --- | --- | --- |
| `users` | `id` PK、`uuid` UNIQUE、`mobile` UNIQUE、`password_hash`、状态 | 人的全局身份。 |
| `accounts` | `id` PK、`type(personal/team)`、`owner_user_id`、名称、状态 | 个人和团队租户。 |
| `account_members` | UNIQUE(`account_id`,`user_id`)、角色、加入状态 | 团队成员和权限归属。 |
| `roles`、`role_permissions`、`project_permissions` | 账号/项目维度唯一约束 | 团队全局与项目授权。 |
| `refresh_sessions` | token 哈希 UNIQUE、用户、活跃账号、过期/撤销时间 | 续期、踢下线和账号切换。 |
| `sms_challenges` | 手机/场景、验证码哈希、过期、尝试次数 | 短信登录/绑定。 |
| `dramas` | `id`、`account_id`、创建人、类型、父组、软删时间 | 短剧项目与项目组。 |
| `canvases` | `id`、`drama_id`、标题、`version`、`schema_version`、更新时间 | 画布图的版本真源。 |
| `canvas_viewports` | UNIQUE(`canvas_id`,`user_id`)、`x`,`y`,`window_zoom_rate` | 每个用户的视口，独立于图版本。 |
| `nodes` | `id` PK、UNIQUE(`canvas_id`,`uuid`)、`type`、`node_name`、`position_x/y`、`size`、`parent_uuid`、`z_index`、`content`、`extra_data` JSONB | 画布业务节点。 |
| `connections` | `id` PK、UNIQUE(`canvas_id`,`uuid`)、`source_uuid`,`target_uuid`、锚点、`extra_data` JSONB | 画布连线；端点必须同画布且存在。 |
| `canvas_events` | `event_id` UNIQUE、`canvas_id`、`server_version`、payload、时间 | 如承诺断线补发，记录持久事件或至少可用版本化快照重同步。 |
| `model_catalog`、`model_capabilities` | `model_code` UNIQUE；能力 `capability_id` UNIQUE、node/mode、schema/revision、状态 | 模型能力与定价来源。 |
| `generation_requests` | UNIQUE(`account_id`,`endpoint`,`request_id`)、`payload_hash`、状态、稳定响应 | 付费生成意图幂等真源。 |
| `generation_tasks` | `task_id` UNIQUE、`request_id` FK、`task_index`、状态、provider job id、进度/结果；批次 UNIQUE(`request`,`task_index`) | 单次和批量子任务。 |
| `credit_wallets`、`credit_ledger` | 账号余额；流水唯一业务来源键、借贷类型、精确金额 | 充值、扣费、退款和审计。 |
| `outbox_events` | `id`、event type、payload、投递状态/尝试次数 | 数据库提交后可靠入队/广播。 |
| `media_assets` | `account_id`、object key UNIQUE、hash、MIME、尺寸/时长、状态 | OSS 上传登记与历史资产。 |
| `materials`、`subjects`、`canvas_library_nodes`、`voices` | `account_id`、创建者、资源引用、业务字段 | 素材/主体/节点库/音色。 |
| `scripts`、`script_episodes`、`script_steps` | `account_id`、状态、正文、软删 | 剧本与分集编辑。 |
| `plans`、`orders`、`payment_events`、`subscriptions`、`invoices` | 金额分、订单号 UNIQUE、回调事件 UNIQUE、权益状态 | 会员、充值、空间、席位、发票。 |
| `opuses`、`activities`、`notifications` | 账号/创建者、发布状态、活动关联 | 首页作品与活动模块。 |

对 `nodes.extra_data` 与能力 JSONB 设置服务端 schema 校验和大小上限；仅把需要查询/关联的字段正规化成列。`parent_uuid` 与 `connections` 端点必须保持同画布一致。所有租户资源表建立 `(account_id, id)` 或可经父表快速验证归属的索引。

### 4.2 必须原子完成的操作

1. `POST /node/batch`：锁定画布版本行 → 检查 `expected_version` → 校验全部增删改与端点/分组关系 → 执行节点和连线操作 → 收集真实级联删除 ID → 版本加一 → 写事件/outbox → 提交。任一失败全回滚。响应必须包含创建项的服务端 ID 和最终 `version`。
2. 生成受理：验证权限/能力/额度/并发 → 登记 `generation_requests` 和子任务 → 扣费流水或预留额度 → 写 outbox → 同一事务提交。事务外由 outbox 投递 BullMQ。失败退款或释放预留以唯一业务键幂等执行。
3. 支付回调：验签和订单归属/金额 → 唯一事件去重 → 更新订单与权益/积分流水 → 同一事务提交。客户端轮询或主动上报不能直接标记已支付。
4. 团队切换、移除成员、转移管理员：权限与会话/WS 失效统一收口，避免旧账号身份继续保存或扣费。

## 5. 核心接口的精确契约

### 5.1 画布管理与三条保存通道

**已确认契约：**节点与连线保存走 `POST /api/node/batch`；个人视口走 `PUT /api/drama/canvas/{id}`；`POST /api/workflow/execute` 只触发执行。这三条通道互相独立，不存在 `/workflow/save` 路由。参见 [`README.md`](../../README.md)、[`api/project/index.ts`](../../api/project/index.ts)、[`api/workflow/index.ts`](../../api/workflow/index.ts)。

`GET /api/drama/canvas/{canvas_id}` 至少返回画布 `canvas_id`、`drama_id`、`version`、`schema_version`、`nodes`、`connections`、个人 `settings`；节点采用 `node_id + uuid + type + node_name + position + extra_data + parent_uuid + size + z_index`，文本节点正文可在顶层 `content`。连线采用 `connection_id + uuid + source_uuid + target_uuid + source_anchor + target_anchor`。完整宽松字段见 [`api/project/types.ts`](../../api/project/types.ts)。`GET /api/drama/canvas/options?drama_id=` 返回 `data.list[{canvas_id,canvas_title}]`。

协作补偿查询也属于画布基础能力：`POST /api/nodes` body `{ids:[node_id]}`，返回 `data.list`，单项字段与画布详情节点一致，并应避免缓存旧数据；`GET /api/connection/{id}` 返回该连线详情。`POST /api/node/download` body `{node_id,index?}`，返回 `data.url`（或兼容旧 URL 数组），后端必须对水印、权限、签名与所选多图下标重新判定。`GET /api/node` 返回可创建节点类型列表。详见 [`api/node/index.ts`](../../api/node/index.ts)。

`POST /api/drama/canvas` 请求 `{drama_id,title}`，创建后响应须给出 `canvas_id` 或 `id`；`PUT /api/drama/canvas/rename` 为 `{canvas_id,canvas_title}`；`POST /api/drama/canvas/copy` 同请求形状；`DELETE /api/drama/canvas/{id}` 无 body。复制必须复制图结构与资源引用的合法业务关系，同时生成新的 canvas/node/connection ID，并保持组与端点对应。

`PUT /api/drama/canvas/{id}` body：

```json
{ "window_zoom_rate": 206, "x": 120, "y": -40 }
```

`window_zoom_rate` 是百分比（Vue Flow `zoom=2.06` 对应 `206`）。建议对该用户视口 upsert；不推进 `canvases.version`，不广播图变更。

### 5.2 `POST /api/node/batch`

**已确认请求结构**（数组可省略，创建节点不传数据库 `id`；下面 ID/值仅示例）：

```json
{
  "drama_id": 59,
  "canvas_id": 37,
  "expected_version": 8,
  "nodes": {
    "create": [{
      "uuid": "node-a", "node_name": "图片", "type": "image",
      "position": { "x": 120.5, "y": 80 },
      "extra_data": { "model_code": "example-model", "scene": "text2image", "parameters": { "ratio": "16:9" }, "features": {} },
      "parent_uuid": null, "size": { "width": 320, "height": 240 }, "z_index": 2
    }],
    "update": [{
      "id": 101, "uuid": "node-b", "node_name": "正文", "type": "text",
      "position": { "x": 420, "y": 80 }, "content": "新的文本正文",
      "extra_data": { "prompt": "生成文案" }
    }],
    "delete": [{ "id": 102 }]
  },
  "connections": {
    "create": [{
      "uuid": "edge-a", "source_uuid": "node-a", "target_uuid": "node-b",
      "source_anchor": "out", "target_anchor": "in", "type": "default",
      "extra_data": {}
    }],
    "update": [], "delete": [{ "id": 301 }]
  }
}
```

边界规则：

- `drama_id` 与 `canvas_id` 必须对应并归属当前账号。`nodes.update/delete` 与 `connections.delete` 的数据库 ID 必须属于目标画布；`uuid` 在画布内唯一。`connections.create/update` 的 source/target UUID 必须在事务最终图中存在。
- 正式组归属用 `parent_uuid`，`null` 表示从仍存在的组移出；禁止跨画布 parent、循环父子关系。`group`/`grouping` 外框和子节点按客户端传来的位置/尺寸保存，服务端不得擅自重算导致漂移。
- 文本节点 `content` 在节点顶层，与 `extra_data.prompt` 不同；`extra_data` 中的模型配置扁平放 `model_code/scene/parameters/features`，不可再套 `generation` 或旧 `params`。`z_index` 用来持久化默认层级，不接受 Vue Flow 临时选中抬升值。
- 删除节点时清理所有关联边，返回全部实际删除的节点/连线 ID，包含级联产生的边。禁止部分成功后仍返回 `code=200`。
- `expected_version` 不匹配时返回 409，并携带 `data.current_version`；该请求不能写入任何节点、边或版本。成功后严格单调递增一个画布版本。
- `client_op_ids` **当前不在请求体里**。响应 `ack_client_op_ids` 只是可选协作兼容字段，不得声称已按该 ID 做服务端幂等。重试防重须由版本、唯一约束和客户端重载策略保证；若后续增加批次级幂等键，先协商前端协议。

**建议的成功响应：**

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "version": 9,
    "updated_at": 1790000000000,
    "nodes": { "create": [{ "uuid": "node-a", "node_id": 103 }], "update": [{ "uuid": "node-b", "node_id": 101 }] },
    "connections": { "create": [{ "uuid": "edge-a", "connection_id": 302, "source_uuid": "node-a", "target_uuid": "node-b", "source_anchor": "out", "target_anchor": "in" }] },
    "deleted_node_ids": [102],
    "deleted_connection_ids": [301]
  }
}
```

如创建时服务端重写 UUID，响应必须回传重写后的 UUID 和能让前端正确映射的 ID；最稳妥做法是保留合法客户端 UUID。批量响应中的多条连线必须逐项回传 UUID，前端按 UUID 匹配。参见 [`collectBatchSavedCollaborationChanges.ts`](../../composables/workflow/persistence/collectBatchSavedCollaborationChanges.ts)。

### 5.3 模型列表、能力和询价

`GET /api/node/models` 返回 `data.list`，每项包含 `model_code`、`model_name`、可选 `model_type`、`capabilities[]`。后端以 `model_code + node_type + mode_type` 定位能力；同一模型可有多个模式。能力包含 `capability_id`、`input_schema`、普通参数 `parameters[]`、复杂功能 `features[]`、可选 `sub_abilities.generate_mode[]` 与展示配置。字段详见 [`api/node/types.ts`](../../api/node/types.ts)。

```json
{
  "model_code": "example-image",
  "model_name": "示例图片模型",
  "capabilities": [{
    "capability_id": "example-image:text2image:v1",
    "node_type": "image", "mode_type": "text2image", "scene": "text2image",
    "input_schema": { "text": { "min": 1, "max": 5000 }, "images": { "max": 0 } },
    "parameters": [
      { "key": "ratio", "label": "比例", "value_type": "string", "required": true, "default": "1:1", "options": [{ "label": "方形", "value": "1:1" }, { "label": "横屏", "value": "16:9" }] },
      { "key": "count", "label": "数量", "value_type": "number", "required": true, "default": 1, "min": 1, "max": 4, "step": 1 }
    ],
    "features": []
  }]
}
```

此 JSON 是**建议种子样例，不是真实供应商模型**。生产模型必须由实际接入的能力配置和 Provider Adapter 注册。服务端对输入类型、数量/长度、必填项、选项、范围、feature 字段和 schema/revision 再验证；不接受未声明字段。仅供 UI 展示的兜底值不得扩展执行能力。`features` 的 UI 配置只能是安全 token，不接受组件路径、HTML 或脚本。`provider`/厂商私有参数不得从前端 create 请求直接透传。

`POST /api/node/credit` 的请求体与单次 `POST /api/task/generation/create` **同构**；采用同一服务端归一与定价函数。建议稳定返回 `data.credit`（数值），并可附计算明细；前端目前兼容多个积分字段名，联调后固定一个。询价不扣费。保存的节点 `extra_data` 中对应参数也来自同一规范化能力配置。

### 5.4 单次与批量生成

**单次已确认请求体**（精确定义见 [`api/task-generation/types.ts`](../../api/task-generation/types.ts)）：

```json
{
  "request_id": "a9304d74-4f5f-44ca-9b4d-725c515448d1",
  "drama_id": 59, "canvas_id": 37, "node_id": 101,
  "node_type": "image", "task_type": "image",
  "model_code": "example-image", "capability_id": "example-image:text2image:v1",
  "mode_type": "text2image", "schema_version": 1, "model_revision": 1,
  "scene": "text2image",
  "inputs": { "prompt": "雪山上的猫", "images": [], "videos": [], "audios": [], "texts": [] },
  "parameters": { "ratio": "16:9", "count": 2 },
  "features": {}
}
```

`request_id`、能力版本等字段只在前端拿到真实值后传，后端按配置验证；不要求旧请求伪造值。媒体输入可以是 URL 字符串或 `{url,type,regions,role,node_id,node_uuid,asset_id,volc_asset_id,...}` 对象；`type=focus` 时 `regions` 是单个像素区域对象。普通参数只能为 string/number/boolean，复杂结构必须进入声明过的 `features`。当前前端会清理部分旧字段；后端仍应拒绝未知执行字段并给出明确错误。

批量 `POST /api/task/generation/batch_create` 为 `{request_id?,drama_id,node_id,tasks:[...]}`；`tasks[]` 有 `model_code,node_type,task_type,inputs,parameters,features` 和可选能力/模式字段；**批量 `request_id` 在顶层**，数组下标是稳定顺序。`features.id` 是资产或分镜关联 ID，不是幂等键。成功响应建议 `data.task_ids` 按请求下标稳定排序。详情见 [`api/task-generation/README.md`](../../api/task-generation/README.md)。

**单次创建建议响应**：`{"code":200,"data":{"task_id":"task-1","request_id":"...","status":"queued","progress":0}}`。同步完成可直接给 `status=completed` 和 `result.outputs`。**批量建议响应**：`{"code":200,"data":{"task_ids":["task-1","task-2"]}}`。已受理但暂时无法确认结果时，必须保留原请求意图供重试，不返回空成功或让客户端误判“可用新 ID 再创建”。

`POST /api/task/generation/progress` 请求 `{task_ids:[...]}`；建议返回 `data.list`，每项 `{task_id,status,progress,result,error_message,node_id?,asset_id?}`。状态采用 `queued/running/completed/failed/canceled`；完成时进度 100，`result.outputs` 分别承载图片/视频/音频/文本。当前解析器还兼容旧 `progresses/tasks/items` 和多种状态，见 [`generationTaskResponse.ts`](../../utils/flow/generationTaskResponse.ts)。`POST /api/task/generation/cancel` 请求为 `application/x-www-form-urlencoded`，字段 `task_id`；取消与完成竞态要返回最终权威状态，扣费退回按既定账务规则幂等执行。

#### 生成幂等与故障恢复（必须实现）

1. 从服务端认证得到的账号、接口路径和 `request_id` 建立持久唯一约束；每次重复请求仍校验用户能否访问目标资源。
2. 对语义化归一后的请求构造稳定摘要：对象 key 顺序不影响摘要，数组顺序影响摘要。同 ID 同摘要返回原任务集合；同 ID 不同摘要返回 409，不能再次扣费。
3. 创建请求记录、任务记录、积分流水/预留和 outbox 必须在一次数据库事务里提交；并发重复调用只有一个事务获胜。批量子任务按 `(请求记录,task_index)` 唯一。
4. worker 至少一次执行，因此调用厂商时优先使用厂商幂等键；未知是否已受理时先查询/对账，不能盲目再提交并重复收费。BullMQ job ID 只做队列层去重，不代替数据库唯一约束。
5. 客户端超时、丢响应、服务重启、批次中途故障后，原 `request_id` 可恢复并重放**完整且顺序稳定**的结果。幂等记录保留期由运营明确；过期的旧 ID 不能直接被当作全新付费请求。
6. 只有确定任务和扣费都未受理时，才返回可结束意图的业务拒绝。`412` 并发上限、额度不足等拒绝应发生在事务受理前。对于已受理后的故障，保留可查询/可重试状态。
7. 终态保存节点结果、资产归属和退款/补偿要防旧任务覆盖新任务；使用 task ID、generation/session ID 或节点期望任务 ID 作条件更新。

**协议边界：**上述强幂等保证以客户端传入稳定 `request_id` 为前提。`/scene/*` 和部分旧 `/script/*` 生成入口目前没有同样的字段；后端不能声称仅凭服务端生成的随机 ID 就解决「已受理但响应丢失后客户端重试」的问题。应把这些入口列为联调协议缺口：先保持现有路由可用，按实际产品规则限制重试/扣费；在前端补充稳定请求 ID 或明确可查询意图协议后，才承诺跨超时精确去重。短时按请求内容去重可能把用户主动发起的相同生成误判为重试，不能作为通用替代。

### 5.5 Workflow 执行

`POST /api/workflow/execute` body 为 `{workflow_id?,project_id?,title?,document}`，`document` 包含 `schemaVersion,version,rootNodeIds,terminalNodeIds,nodes,edges`，定义见 [`types/workflow.ts`](../../types/workflow.ts)。它只触发执行，不能隐式替代 `/node/batch` 保存。服务端需校验图与资源归属、节点端口依赖、循环及执行权限；返回 `execution_id,workflow_id,status`。执行编排应复用生成任务和账务服务，避免第二套模型入参/扣费实现。

### 5.6 协作 WebSocket

前端建立原生 `new WebSocket(url)`；全局业务 WS 由 `NUXT_PUBLIC_WS_URL` 形成 `/?token=...`，画布协作 WS 可以来自模板 `{canvasId}` 或 HTTP/WS 基址推导，token 也在 URL query。WebSocket 连接成功后服务端须尽快发 `{"type":"connect","data":{"client_id":"..."}}`，之后前端调用 `POST /api/team/join`，body `{drama_id,canvas_id,client_id}`；该接口返回 `data.list` 成员与 `data.locks` 锁快照。服务端要校验 `client_id` 属于当前鉴权连接、用户有画布访问权。详见 [`api/group/index.ts`](../../api/group/index.ts)。

消息格式是 `{type,data}`，而 Nest `WsAdapter` 默认读取 `{event,data}`；接入时配置 parser 或使用 `ws` 自定义处理，**不要要求前端改为 Socket.IO 协议**。主要消息见 [`types/flow/canvasCollaboration.ts`](../../types/flow/canvasCollaboration.ts)：

| 类型 | 方向与意义 | 后端处理 |
| --- | --- | --- |
| `connect`、`canvas:presence`、`kick_out` | 服务端入站到前端 | 分配连接 ID、在线快照、同用户旧会话踢出。 |
| `mouse_move`、`node_move_end` | 前端发；转发其他成员 | 鼠标/拖拽预览限频；最终坐标须和持久化 batch 对齐。 |
| `locked_node`、`unlocked_node` | 双向 | 按画布/节点建立带租约的临时锁，断线或过期释放；生成锁与普通锁类型不同。 |
| `update_node` | 前端保存后发；服务端广播 | 含 `node_ids`，对端会再拉节点详情；只广播已提交的服务端 ID。 |
| `upsert_connection` | 双向 | 携带完整连线记录，包含 `connection_id`、两端 UUID 与锚点。 |
| `canvas_graph_delete` | 双向 | 一次传节点与连线删除 ID；新实现用此类型。旧 `delete_node/delete_connection` 仅兼容入站。 |
| `generate_percentage` | 双向 | 生成进度提示；权威任务状态仍取自任务服务。 |

结构事件建议包含稳定 `event_id`、单调 `server_version` 和发起方 `client_id`；对端用它去重、乱序过滤和检测缺口。画布 batch 提交后的广播从**提交后的 outbox**产生，不能提前广播未落库的图。前端当前也会在 batch 成功后发送协作通知，服务端须避免把同一变化重复广播为两个不同版本；优先以数据库提交事件为权威，再根据前端通知做幂等回声抑制。断线重连必须能按版本补发事件或要求前端重新拉 `GET /drama/canvas/{id}` 权威快照。锁是协作提示，不替代 DB 版本检查。

### 5.7 OSS、媒体和资产

`GET /api/oss/sts` 的 `data` 至少含 `access_key_id,access_key_secret,bucket,endpoint,expiration,region,security_token`，`expiration` 为 Unix 秒级时间戳；字段来自当前 [`ossUpload.ts`](../../utils/media/ossUpload.ts)。服务端按当前账号签发允许前缀、上传动作和短有效期的临时凭证。STS policy 限制 bucket、对象目录和操作；同浏览器切换账号后不能继续使用旧账号授权。

`POST /api/upload/data` 的 body 精确字段：`category(image/video/audio),origin_name,object_name,hash,mime_type,storage_path,suffix,size_byte,url`，视频还需 `fps,seconds`，音频需 `seconds`，图/视频需 `width,height`。服务端从 STS 授权范围或 OSS 元数据核对对象 key、尺寸、大小、MIME 与当前账号归属，重复上传登记需可幂等。资产下载/签名 URL 不泄露跨账号资源。

`POST /api/volc-asset` 提交 `{url,asset_type}`，`GET /api/volc-asset/{id}` 查审核记录，`POST /api/volc-asset/check` 请求 `{ids:[volc_asset_id]}`。`status=Active` 后前端按 `update_time + 30 分钟` 推导可用期；服务端 create 时仍要验证一次性 `volc_asset_id` 的真实有效性，不以客户端过期时间为真源。

素材、主体、节点库分别有独立 `/material`、`/subject`、`/canvas/node` API；不要把三个资源表混为一个接口。主体详情的 `content` 为媒体 URL 数组，素材有 `node_data` 快照，工具箱节点有 `parent_node_id`。确切 DTO 见各模块 `types.ts`，完整路径见第 7 节。

### 5.8 积分、订单、会员和支付

`GET /api/credit` 返回当前活跃账号余额字段，前端读取 `total_balance/use_credit/credit_quota`；`GET /api/credit/bill` 查询充值、消耗、退回明细。团队另有额度分配与消耗优先级。余额、账单、任务实际扣费必须来自同一账本事务。

`POST /api/order/create` 使用 `order_type` 区分：`subscribe`（`plan_id,buy_num,team_id?`）、`recharge`（`credit_id` 或 `credit`）、`capacity`（`price_id,capacity_gb`）、`seat_expand`（`buy_num`）。响应 `data.order_no, cashier_url, expire_time`（10 位秒时间戳），可附 `subject,amount`。前端轮询 `GET /api/order/info?order_no=...`，其中 `data.payStatus` 为 `1` 待付、`2` 已付、`3` 已完成、`4` 已取消。`POST /api/order/update` body `{order_no,buy_num}`。详细类型见 [`api/user/member.ts`](../../api/user/member.ts)。

订单价格、购买数量、账号归属由服务端重算；支付回调要验签、金额、商户单号、事件唯一性。退款、会员权益、席位和空间容量按订单类型各自幂等入账。`GET /order/info` 只反映服务端权威状态；不能因浏览器宣称付款或调用 update 就标记已付。发票接口 `POST /invoice/create`、`GET /invoice/file`、`DELETE /invoice/{id}` 也需验证订单归属和开票状态。

## 6. 次要领域的实现要求

第 7 节完整列出当前前端 API 调用。以下模块缺少完整服务端协议，编码 AI 应先读取对应 `api/*/types.ts` 与页面调用点，补出 DTO/OpenAPI，并用真实业务语义实现：

| 模块 | 主要行为 | 重要约束 |
| --- | --- | --- |
| 剧本 | `/script/*` 创建、生成、步骤确认、回收站、个人导入 | 剧本与画布是不同资源；脚本生成调用统一任务/积分服务，脚本步骤改动需权限和版本控制。 |
| 团队 | `/account/*`、`/data/permission/*`、`/data/statistics/*` | 管理员操作服务端授权；成员移除后撤销会话/WS；统计只查本账号。 |
| 素材/主体/节点库 | `/material`、`/subject`、`/canvas/node` | 资源与原始媒体归属可追溯；删除/导入不产生跨租户引用。 |
| 创作工具 | `/scene/*`、`/voice/*`、`/camera`、`/image/style/*` | 外层兼容旧接口，内部复用 Provider Adapter、任务中心、账本；同步结果与异步 `task_id` 按各端点现状返回。 |
| 首页与作品 | `/home/*`、`/opus/*`、`/activity/*`、`/notification/*`、`/article/detail` | 公开与私有内容分离；分享/克隆需授权和版权/资源可见性检查。 |
| 套餐、空间、发票 | `/plan/*`、`/space/*`、`/order/*`、`/invoice/*` | 配置由服务端提供；金额与权益变更只能由订单/回调/管理操作驱动。 |

对于 `api/scene/types.ts` 已有明确 body 的工具端点，直接按类型实现；`any` 接口不得任意接受并持久化未知字段。API 逐个在 OpenAPI 标注鉴权、请求/响应示例、错误码和状态，并提供对应集成测试。

## 7. 当前前端 API 调用清单

以下为对 `api/` 中直接 `request` / `$fetch` 调用的静态提取，共 **198 个调用点**；同一路由可能被多个函数调用，动态模板统一显示为 `{id}`。实际 URL 均在 `NUXT_PUBLIC_API_BASE` 的 `/api` 前缀下。此表证明前端会调用这些路径，不证明响应字段已完整定义。未包含现有 Nitro 的 `/api/media/*` 路由。代码 AI 须逐项读取关联源码、类型和页面调用点，写入 OpenAPI，并标出仍需业务确认的字段。

### 7.1 [api/activity/index.ts](../../api/activity/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/activity` | `getActivityList` |
| GET | `/activity/{id}` | `getActivityDetail` |
| POST | `/activity/signup` | `signupActivity` |
| GET | `/activity/signup` | `getActivitySignup` |
| GET | `/activity/signup/draft` | `getActivitySignupDraft` |
| GET | `/activity/signup/select` | `getActivitySignupSelect` |
| POST | `/activity/opus` | `submitActivityOpus` |

### 7.2 [api/article/index.ts](../../api/article/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/article/detail` | `getArticleDetail` |

### 7.3 [api/asset/index.ts](../../api/asset/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/asset/history` | `fetchAssetHistory` |

### 7.4 [api/camera/index.ts](../../api/camera/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/camera` | `fetchCameraList` |
| POST | `/camera/collect` | `collectCameraMotion` |
| POST | `/camera` | `saveCameraMotion` |
| DELETE | `/camera` | `deleteCameraMotion` |

### 7.5 [api/canvas-node/index.ts](../../api/canvas-node/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/canvas/node` | `fetchCanvasNodeList` |
| GET | `/canvas/node/{id}` | `fetchCanvasNodeDetail` |
| POST | `/canvas/node` | `upsertCanvasNode` |
| DELETE | `/canvas/node` | `deleteCanvasNodes` |

### 7.6 [api/common/index.ts](../../api/common/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/oss/sts` | `getOssSts` |
| GET | `/notification` | `getNotificationList` |
| GET | `/notification/{id}` | `getNotificationDetail` |
| GET | `/home/init` | `getHomeInit` |

### 7.7 [api/group/index.ts](../../api/group/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/team/join` | `joinTeamProjectRoom` |

### 7.8 [api/group/role.ts](../../api/group/role.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/data/permission/project` | `getProjectPermissionList` |
| GET | `/data/permission` | `getTeamGlobalPermission` |
| POST | `/data/permission` | `saveTeamGlobalPermission` |
| POST | `/data/permission/project` | `saveProjectPermission` |

### 7.9 [api/group/space.ts](../../api/group/space.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/space/price` | `getSpacePrice` |
| GET | `/space/bill` | `getSpaceBill` |
| GET | `/account/space` | `getAccountSpace` |

### 7.10 [api/group/statistics.ts](../../api/group/statistics.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/data/statistics/panel` | `getGroupStatisticsPanel` |
| GET | `/data/statistics/project` | `getGroupStatisticsProject` |
| GET | `/data/statistics/member` | `getGroupStatisticsMember` |
| GET | `/data/statistics/project/{id}` | `getGroupStatisticsProjectDetail` |
| GET | `/data/statistics/member/{id}` | `getGroupStatisticsMemberDetail` |

### 7.11 [api/home/index.ts](../../api/home/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/home/carousel` | `getHomeCarousel` |

### 7.12 [api/home/opus.ts](../../api/home/opus.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/drama/personal/subset` | `getPersonalSubset` |
| GET | `/opus/type` | `getOpusTypeList` |
| POST | `/opus` | `publishAndEditOpus` |
| DELETE | `/opus/{id}` | `deleteOpus` |
| GET | `/opus/collection` | `getMyCollectOpusList` |
| GET | `/opus` | `getMyOpusList` |
| GET | `/opus/{id}` | `getOpusDetail` |
| PUT | `/opus/collection/{id}` | `collectAndCancelCollectOpus` |
| GET | `/opus/recommend` | `recommendOpusList` |
| GET | `/opus/award` | `getOpusAwardList` |
| POST | `/opus/clone` | `cloneOpus` |
| GET | `/opus/recommend/{id}` | `getRecommendOpusDetail` |
| GET | `/opus/top/{id}` | `getOpusTopList` |
| GET | `/opus/process/{id}` | `getOpusProcessData` |

### 7.13 [api/home/order.ts](../../api/home/order.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/order/record` | `getOrderRecordList` |
| GET | `/order/subscribe` | `getOrderSubscribeList` |

### 7.14 [api/image/index.ts](../../api/image/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/drama/canvas/image/scene` | `fetchImageScenePresetList` |
| GET | `/image/style/category` | `fetchImageStyleCategoryList` |
| GET | `/image/style` | `fetchImageStyleList` |
| GET | `/image/style/collection` | `fetchImageStyleCollectionList` |
| GET | `/image/style/recent` | `fetchImageStyleRecentList` |
| POST | `/image/style/collect` | `collectImageStyle` |
| POST | `/image/style/use` | `useImageStyle` |

### 7.15 [api/library/index.ts](../../api/library/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/asset` | `getAssetList` |
| DELETE | `/asset` | `deleteAsset` |

### 7.16 [api/login/index.ts](../../api/login/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/sms/send` | `sendLoginSmsCode` |
| POST | `/login/sms` | `smsLogin` |
| POST | `/login/password` | `passwdLogin` |
| POST | `/auth/refresh` | `refreshAuth` |
| POST | `/login/wechat` | `wechatLogin` |
| POST | `/user/bindPhone` | `bindPhone` |

### 7.17 [api/material/index.ts](../../api/material/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/material` | `createMaterial` |
| GET | `/material/{id}` | `fetchMaterialDetail` |
| GET | `/material` | `fetchMaterialList` |
| DELETE | `/material` | `deleteMaterials` |
| DELETE | `/material` | `deleteMaterial` |

### 7.18 [api/node/index.ts](../../api/node/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/node` | `fetchCreatableNodeList` |
| POST | `/nodes` | `fetchNodeDetail` |
| POST | `/node/download` | `fetchNodeDownload` |
| GET | `/connection/{id}` | `fetchConnectionDetail` |
| GET | `/node/models` | `fetchNodeModels` |
| POST | `/node/prompt/translate` | `translateNodePrompt` |
| POST | `/node/credit` | `fetchNodeCredit` |
| POST | `/node/batch` | `batchSaveNodes` |

### 7.19 [api/project/index.ts](../../api/project/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/drama` | `getProjectList` |
| POST | `/drama` | `createProjectCanvas` |
| DELETE | `/drama` | `deleteProject` |
| PUT | `/drama` | `updateProject` |
| GET | `/drama/subset` | `getAllChildList` |
| GET | `/project/recycle` | `getTrashList` |
| POST | `/project/recycle/restore` | `restoreProject` |
| DELETE | `/project/recycle` | `destroyRecycleProjects` |
| POST | `/drama/move` | `moveDrama` |
| POST | `/drama/batchMove` | `batchMoveDrama` |
| POST | `/drama/untie` | `untieDrama` |
| POST | `/drama/merge` | `mergeDrama` |
| GET | `/drama/personal` | `getPersonalDramaList` |
| POST | `/drama/import` | `importFromPersonalDrama` |
| GET | `/drama/canvas/{id}` | `getCanvasDetail` |
| POST | `/drama/canvas` | `createDramaCanvas` |
| GET | `/drama/canvas/options` | `getDramaCanvasOptions` |
| PUT | `/drama/canvas/{id}` | `updateProjectCanvas` |
| DELETE | `/drama/canvas/{id}` | `deleteDramaCanvas` |
| PUT | `/drama/canvas/rename` | `renameDramaCanvas` |
| POST | `/drama/canvas/copy` | `copyDramaCanvas` |

### 7.20 [api/project/script.ts](../../api/project/script.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/script/attrs` | `getScriptAttrsTree` |
| GET | `/script/getCost` | `getScriptCost` |
| POST | `/script` | `createScript` |
| PUT | `/script` | `updateScript` |
| DELETE | `/script/{id}` | `destroyScript` |
| PUT | `/script/{id}` | `deleteScript` |
| POST | `/script/batchDestroy` | `batchDestroyScripts` |
| GET | `/script` | `getRecentScripts` |
| GET | `/script/personal` | `getPersonalScripts` |
| POST | `/script/import` | `importFromPersonalScripts` |
| GET | `/script/{id}` | `getScriptDetail` |
| GET | `/script/recycleBin` | `getScriptRecycleBin` |
| PUT | `/script/restore/{id}` | `restoreScript` |
| PUT | `/script/update` | `updateScriptResult` |
| PUT | `/script/generate` | `generateScriptContent` |
| PUT | `/script/optimize` | `optimizeScriptContent` |
| PUT | `/script/confirmStep` | `confirmScriptStep` |
| POST | `/team/join/script` | `joinScriptRoom` |

### 7.21 [api/prompt/index.ts](../../api/prompt/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/prompt` | `fetchPromptList` |
| GET | `/prompt/model` | `fetchPromptModelList` |

### 7.22 [api/scene/index.ts](../../api/scene/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/scene/crop` | `generateSceneCrop` |
| POST | `/scene/angle` | `generateSceneAngle` |
| POST | `/scene/matting` | `generateSceneMatting` |
| POST | `/scene/expand` | `generateSceneExpand` |
| POST | `/scene/redraw` | `generateSceneRedraw` |
| POST | `/scene/erase` | `generateSceneErase` |
| POST | `/scene/lighten` | `generateSceneLighten` |
| GET | `/lighten/preset` | `fetchSceneLightenPresetList` |
| POST | `/scene/video-audio-split` | `generateSceneVideoAudioSplit` |
| POST | `/scene/frame-prediction` | `generateSceneFramePrediction` |
| POST | `/scene/upscale` | `generateSceneUpscale` |
| POST | `/scene/upscaleVideo` | `generateSceneUpscaleVideo` |
| POST | `/scene/videoErase` | `generateSceneVideoErase` |
| POST | `/scene/vocal-split` | `generateSceneVocalSplit` |

### 7.23 [api/subject/index.ts](../../api/subject/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/subject` | `fetchSubjectList` |
| POST | `/subject` | `createSubject` |
| GET | `/subject/{id}` | `fetchSubjectDetail` |
| PUT | `/subject` | `updateSubject` |
| DELETE | `/subject` | `deleteSubjects` |
| GET | `/subject/timbre` | `fetchSubjectTimbreList` |
| POST | `/subject/timbre` | `createTimbre` |
| DELETE | `/subject/timbre` | `deleteTimbre` |

### 7.24 [api/task-generation/index.ts](../../api/task-generation/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/task/generation/create` | `createGenerationTask` |
| POST | `/task/generation/batch_create` | `createGenerationTasksBatch` |
| POST | `/task/generation/progress` | `fetchGenerationTaskProgress` |
| POST | `/task/generation/cancel` | `cancelGenerationTask` |

### 7.25 [api/upload/index.ts](../../api/upload/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/upload/data` | `saveUploadData` |

### 7.26 [api/user/group.ts](../../api/user/group.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/account` | `createGroup` |
| PUT | `/account/{id}` | `updateGroup` |
| GET | `/credit/priority` | `getCreditPriority` |
| PUT | `/credit/priority` | `updateCreditPriority` |
| POST | `/credit/priority` | `resetCreditPriority` |
| GET | `/account/{id}` | `getGroupInfo` |
| GET | `/account/member` | `getGroupMemberList` |
| POST | `/account/invite` | `inviteGroupMember` |
| POST | `/account/accept` | `inviteGroupMemberAccept` |
| POST | `/account/dissolve` | `dissolveGroup` |
| POST | `/credit/allocate` | `allocationCredit` |
| POST | `/account/remove` | `removeGroupMember` |
| POST | `/account/transfer` | `transferAdmin` |
| GET | `/account/invite` | `getInviteGroupMemberList` |
| POST | `/account/invite/review` | `reviewInviteGroupMember` |
| GET | `/account/member/select` | `getGroupMemberSelectList` |

### 7.27 [api/user/index.ts](../../api/user/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/user/info` | `getUserInfo` |
| GET | `/account` | `getMyAccountList` |
| GET | `/plan` | `getPlanList` |
| POST | `/account/change` | `accountChange` |
| POST | `/account/quit` | `quitAccount` |
| GET | `/account/watermark` | `getAccountWatermark` |
| POST | `/account/watermark` | `updateAccountWatermark` |
| GET | `/credit` | `getCreditInfo` |
| PUT | `/user/info` | `updateUserInfo` |
| GET | `/creditConfig` | `getCreditConfig` |
| GET | `/credit/bill` | `getCreditBill` |
| GET | `/models/select` | `getModelSelect` |

### 7.28 [api/user/invoice.ts](../../api/user/invoice.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/invoice/create` | `createInvoice` |
| DELETE | `/invoice/{id}` | `cancelInvoice` |
| GET | `/invoice/file` | `getInvoiceFile` |

### 7.29 [api/user/member.ts](../../api/user/member.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/plan` | `getPlanList` |
| GET | `/order/info` | `getOrderInfo` |
| POST | `/order/create` | `createOrder` |
| POST | `/order/update` | `updateOrder` |
| GET | `/plan/renew` | `getRenewalPlan` |
| GET | `/plan/upgrade` | `getUpgradePlan` |
| GET | `/plan/seat-expand` | `getSeatExpandInfo` |

### 7.30 [api/user/role.ts](../../api/user/role.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/account/role` | `createRole` |
| GET | `/account/role` | `getRole` |
| DELETE | `/account/role/{id}` | `deleteRole` |

### 7.31 [api/voice/index.ts](../../api/voice/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| GET | `/voice` | `fetchVoiceList` |
| POST | `/voice/collect` | `toggleVoiceCollect` |
| POST | `/voice/create` | `createVoice` |
| PUT | `/voice/update` | `updateVoice` |
| DELETE | `/voice/delete` | `deleteVoice` |
| POST | `/voice/clone` | `cloneVoice` |

### 7.32 [api/volc-asset/index.ts](../../api/volc-asset/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/volc-asset` | `submitVolcAsset` |
| GET | `/volc-asset/{id}` | `fetchVolcAssetDetail` |
| POST | `/volc-asset/check` | `checkVolcAssets` |

### 7.33 [api/workflow/index.ts](../../api/workflow/index.ts)

| 方法 | 路径（不含 `/api`） | 前端函数 |
| --- | --- | --- |
| POST | `/workflow/execute` | `submitWorkflowExecution` |

## 8. 环境、配置与本地启动

### 8.1 环境变量清单

生成 `.env.example`，只放无密钥样例和注释。实际名称可调整，但职责必须齐全，并由配置模块启动时验证：

| 配置 | 用途 | 开发默认/要求 |
| --- | --- | --- |
| `NODE_ENV`、`PORT`、`PUBLIC_API_ORIGIN`、`PUBLIC_WS_ORIGIN` | 运行环境、监听端口、外部可访问地址 | 本地明确设置；生产使用 HTTPS/WSS。 |
| `DATABASE_URL`、`REDIS_URL` | PostgreSQL 和 Redis | Docker Compose 可启动本地依赖。 |
| `ACCESS_TOKEN_SECRET`、`REFRESH_TOKEN_SECRET`、`ACCESS_TOKEN_TTL`、`REFRESH_TOKEN_TTL` | 会话签名和寿命 | 生产使用独立强密钥，支持轮换；不要放进日志。 |
| `ALLOWED_WEB_ORIGINS`、`WS_ALLOWED_ORIGINS` | HTTP CORS 和 WS Origin | 明确域名列表，不能在带凭证场景开放通配符。 |
| `OSS_REGION`、`OSS_BUCKET`、`OSS_KEY_PREFIX`、`OSS_STS_ROLE_ARN`、`OSS_PUBLIC_BASE_URL` | 上传签发与对象校验 | 无配置时 STS 路由明确不可用。 |
| `SMS_PROVIDER`、`SMS_*`、`WECHAT_*` | 短信/微信登录 | 开发可用 mock；生产须真实配置。 |
| `AI_PROVIDER_*` | 各模型厂商 API 地址、凭证与回调密钥 | 每个模型能力绑定一个适配器；未配置时不展示或拒绝执行。 |
| `PAYMENT_PROVIDER`、`PAYMENT_*`、`PAYMENT_CALLBACK_BASE_URL` | 支付下单、回调和查询 | 生产回调验签与网络可达性必须单独验收。 |
| `LOG_LEVEL`、`OTEL_*`、`SENTRY_*`（可选） | 日志、指标、追踪 | 至少结构化日志和 request ID。 |
| `IDEMPOTENCY_RETENTION_DAYS`、`TASK_RESULT_RETENTION_DAYS` | 幂等记录/任务结果保留 | 由产品和账务要求确定；过期策略需保护旧 ID。 |
| `MAX_BATCH_NODES`、`MAX_BATCH_CONNECTIONS`、`MAX_GENERATION_TASKS` | 单请求预算 | 给出有限默认值并在 OpenAPI 标明，超限返回明确错误。 |

前端联调只需把 `NUXT_PUBLIC_API_BASE` 指向后端 `/api`，把 `NUXT_PUBLIC_WS_URL` 和可选画布协作 WS 模板指向新 WS 服务。若使用同域反代，确保 `/api/media/*` 仍到 Nuxt Nitro，其他 `/api/*` 到 Nest；路由顺序写进部署文档，避免媒体代理被 Nest 抢占。

### 8.2 本地开发命令与产物

后端项目应提供下列**等价能力**（命令名可按项目习惯调整，但 README 必须可直接复制）：

```text
docker compose up -d postgres redis
npm ci
npm run db:migrate
npm run db:seed:dev
npm run dev:api
npm run dev:worker
npm run typecheck
npm run test
npm run test:integration
npm run build
```

开发种子应有：个人用户、团队管理员与成员、一个短剧和两张画布、节点与边、至少两个不同 `mode_type` 的模型能力、可用的演示积分余额、受权限保护的样例素材。种子账户不得包含生产密码或真实支付/模型密钥。提供 HTTP 健康检查和依赖就绪检查；健康检查不返回配置秘密。

### 8.3 OpenAPI 与契约生成

- 生成 `/openapi.json` 或仓库内 `openapi/openapi.json`；HTTP path 保持 `/api/...`；每个端点写清认证、请求体/查询参数、成功包、业务错误、HTTP 状态、分页、示例。
- OpenAPI DTO、Nest 校验 DTO 与测试用同一数据定义或建立自动一致性检查。对 `NodeBatchSaveRequest`、`CreateGenerationTaskRequest`、模型能力、WS 消息维护明确版本。
- 前端 `api/*/types.ts` 的可选字段多为兼容旧服务端，后端新实现应选择稳定的**首选输出字段**，例如 `node_id`、`connection_id`、`task_id`、`canvas_id`。不要因为类型里写可选就省略核心成功字段。
- 为第三方回调单独定义 OpenAPI/内部文档，不向公开前端暴露管理接口或密钥。

## 9. 验收场景与故障注入

编码 AI 要把本节转成可运行的后端集成测试；真实第三方联调另留验收记录。测试可用真实 PostgreSQL/Redis 测试容器，开发 mock 只模拟外部供应商响应，不模拟数据库事务。

### 9.1 身份、权限和数据隔离

1. 密码/短信/微信登录分别按配置成功或明确不可用；登录返回 access/refresh token；refresh 用 Bearer refresh token 轮换，旧 token 无法再次续期。
2. A 账号用户无法读写 B 的项目、画布、节点、连线、素材、任务、账单、订单、下载或 WS 房间；猜测 ID 也不能泄漏存在性或私人字段。
3. 团队成员、管理员、所有者分别覆盖查看、编辑、生成、删项目、管理成员、分配积分；移出成员后旧 token/WS 权限立即失效。
4. 个人与团队账号切换后，新请求和在途重试都用服务端当前身份校验；不能把旧账号已创建的幂等请求返回给新账号。
5. `share=1` 在没有可核验的分享授权设计前不开放私人画布。若做公开分享，单独定义分享凭证、可见范围、过期和只读权限。

### 9.2 画布与保存

1. 空画布创建 → batch 创建文本/图片/组节点与连线 → 返回服务端 ID → 详情刷新恢复位置、尺寸、`parent_uuid`、文本 `content`、`extra_data`、`z_index`、连线端点和版本。
2. 对同一画布并发提交相同 `expected_version`，只能有一方成功；另一方收到 409 与当前版本，数据库无部分写入。
3. batch 同时删除节点及相连边，响应 `deleted_connection_ids` 完整；其它画布的同 ID 资源不能被删除。
4. 将节点移出仍存在的组时 `parent_uuid:null` 正确保存；非法 parent、循环分组、跨画布端点全量回滚。
5. 连续视口 PUT 更新个人视口；另一个用户的视口不变，画布图版本不变，节点保存次数不增加。
6. `workflow/execute` 在图未保存或版本不符时按明确策略拒绝，不利用执行接口偷偷保存；执行结果不覆盖新任务的节点状态。

### 9.3 能力、生成、积分和任务

1. 一个模型支持某参数，另一个不支持：支持的参数被校验、定价并传适配器；未知/不支持参数拒绝或明确过滤，最终执行请求不含该键。模型切换和 `mode_type` 切换用不同能力。
2. 同一请求 `POST /node/credit` 与 `POST /task/generation/create` 使用同一归一化配置和计价规则；节点 `extra_data` 的核心模型配置一致。能力版本变化时按约定拒绝过期请求或显式重报价。
3. 同 `request_id` 连续、并发、跨进程重试只创建一组任务、一次积分扣费；原响应丢失后可重放原任务 ID。改参数复用 ID 返回 409；不同账号可各自用同一 ID，彼此不串数据。
4. 批量在第 N 项后进程崩溃、worker 重启、Redis 短暂不可用，恢复后顺序、任务集合与扣费唯一；原批结果不伪装成空成功。
5. 模型任务排队、运行、成功、失败、取消均能从 progress 查询；取消与成功竞态只产生一种最终权威状态，补偿/退款不会重复。
6. 达到并发上限时 create 返回业务 412；火山素材过期返回 414，`/volc-asset/check` 返回与 `volc_asset_id` 对应的逐项结果；额度不足返回可读提示且不生成任务。
7. 节点再次生成时，旧 task 的迟到回调/轮询结果不得覆盖新 task 的资源和状态；资产 URL 必须归属当前账号。

### 9.4 WebSocket 与支付

1. 浏览器原生 WebSocket 握手收到 `connect.client_id` → `/team/join` 成功 → 两个成员收到 presence；无权限客户端握手/加入失败。
2. 两客户端的节点更新、删除、连线新增/删除拥有单调版本和稳定事件 ID；重复/乱序消息不产生重复图变更；断线后按版本补发或拉详情恢复。
3. 普通锁与生成锁的获取、拒绝、心跳、过期和断开释放正确；不同账号或无权限连接不能发送跨房间消息；同用户新会话踢旧会话按产品规则执行。
4. 创建订单后，前端 `/order/info` 轮询仍待付；伪造客户端请求无法改成已付。合法平台回调验签/验金额后变已付或已完成；同回调重复投递只加一次权益/积分；错误金额、错误账号、过期/取消订单被拒绝。
5. 回调提交后响应丢失，支付平台重试只重放处理结果；团队席位/空间/积分充值各自有独立权益断言。退款和发票撤销按状态与归属控制。

### 9.5 上传与运行

1. STS 只授予当前用户/账号允许的对象目录；过期、越界 object key、错误 MIME/大小/哈希的登记被拒绝；相同对象重复登记不产生重复资产。
2. 生产配置缺少 OSS、AI 或支付凭证时，涉及的接口返回明确不可用错误；本地模拟模式必须显式启用，日志标识为 mock。
3. API、worker、WS 单独重启，已有受理任务、幂等记录、积分余额和画布版本不会丢；outbox 积压可观测并可恢复。
4. 压测使用代表性节点/连线规模和任务提交量，报告 P50/P95/P99、数据库锁等待、队列滞留、WS 房间规模、内存和带宽。容量结论必须来自实测，不能从框架基准推算。

## 10. 分阶段交付清单

| 阶段 | 可交付物 | 验收证据 |
| --- | --- | --- |
| A：基础 | Nest 工程、配置校验、数据库迁移、Redis、本地 Compose、统一响应、登录/刷新/权限、OpenAPI | 空库启动、认证/越权集成测试、健康检查。 |
| B：画布 | drama/canvas CRUD、详情、个人视口、node/batch、节点/连线查询 | 保存/刷新/冲突/级联/多租户测试；与真实前端画布联调。 |
| C：生成 | 模型 Schema、询价、单/批任务、worker、账本、outbox、progress/cancel、workflow execute | 同源参数测试、幂等/丢响应/崩溃恢复/扣费测试。 |
| D：协作 | 原生 WS、join/presence/锁、提交后事件、重连恢复 | 两浏览器或 WS 客户端的版本、踢出、越权和断线测试。 |
| E：全量接口 | 第 7 节其余路径、OSS、团队、脚本、创作工具、作品/活动/通知、支付/发票 | OpenAPI 覆盖清单、每模块行为测试、第三方沙箱联调。 |
| F：上线候选 | 部署配置、备份恢复、监控告警、支付/AI 真实沙箱、前端端到端 | 登录→上传→保存→询价→生成→支付→重开完整记录。 |

每阶段须输出「已实现接口、仍待确认字段、实际执行命令及结果、真实外部服务测试范围」。不得把类型检查通过、mock 通过或前端 fixture 通过写成真实第三方联调通过。前端的浏览器兼容测试仍按 [`AGENTS.md`](../../AGENTS.md) 的 Safari、Firefox、Chromium 和 macOS/Windows 范围执行；后端测试不能替代浏览器测试。

## 11. 必须先确认或显式配置的外部决策

以下信息不能从当前前端源码可靠推导。生成后端时给出可配置实现与待确认记录；拿到资料后再接生产：

1. **真实模型供应商**：模型目录、各 `model_code` 与 provider API 的映射、价格、限流、回调、任务查询、失败退款规则、媒体保存期限。`docs/libtv-*` 是参考/逆向资料，不等于已授权接入或正式合同。
2. **支付平台**：商户、下单接口、回调签名、退款、账单与发票提供方；订单金额/积分汇率和会员权益来自运营配置。
3. **短信与微信**：服务商账号、微信应用配置、回跳域、反刷规则和隐私条款。
4. **OSS**：账号、bucket、地域、STS 角色、对象前缀、CDN 域名、生命周期、媒体处理与跨域规则。
5. **已有生产数据**：若实际已有非 Node 后端，要先拿表结构和迁移策略；本文件没有现存业务库的映射，不能直接做无损迁移承诺。
6. **公开分享/作品规则**：匿名权限、素材复用、克隆、下载水印、封面审核和活动投稿规则。
7. **接口中 `any` 的字段**：尤其 `/drama` 创建/更新、`/script` 多个步骤、团队管理、首页配置和部分账务响应，必须以页面调用与真实接口样本最终确定。
8. **协作服务协议**：WS URL 路由、事件持久保留期、同一用户多会话策略、锁租约、冲突后的重同步方式。当前 [`README.md`](../../README.md) 也把这些列为待后端对齐。
9. **生成幂等保留期与不确定状态**：数据库保留多久、过期旧 ID 的处理和供应商结果无法查询时的人工对账流程。
10. **旧创作工具的付费重试**：`/scene/*`、部分 `/script/*` 未携带稳定 `request_id`，需确定前端协议升级、账务查询/人工对账和重复提交提示策略。未完成前不得承诺这些入口具有与统一 create 相同的强幂等保证。

## 12. 交付给下一位编码 AI 时可直接复制的任务

> 阅读 `docs/node/backend-generation-spec.md` 和其中引用的当前前端源码。创建独立的 `aimanju-backend` Node.js/TypeScript 项目，按文档第 10 节逐阶段实现。优先完成兼容现有 Nuxt 客户端的 `/api` HTTP 契约、原生 WebSocket 契约和 PostgreSQL 事务/幂等。生成数据库迁移、开发种子、OpenAPI、本地 Docker Compose、`.env.example`、单元与集成测试、部署说明。所有外部供应商采用可替换适配器；没有真实凭证时只在显式开发模式使用 mock，生产调用返回明确错误。按第 7 节逐项核对 API，记录源码没有定死的字段，不擅自假定支付成功、AI 任务成功或跨租户权限。每阶段报告实际运行命令、通过的测试、未接入的外部平台和待确认问题。不要修改前端的保存、生成或 WebSocket 协议来迁就后端实现。
