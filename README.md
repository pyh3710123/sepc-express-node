# AImanju 后端

本仓库是独立运行的 Node.js 22 / TypeScript 后端。实现依据为 [后端生成规格](docs/node/backend-generation-spec.md)，业务 HTTP 前缀为 `/api`，返回体为 `{ "code": 200, "message": "ok", "data": ... }`。`GET /health` 是存活检查，`GET /ready` 检查 PostgreSQL 和 Redis。

原规格引用的 Nuxt 前端源码不在此仓库。当前实现以规格中明确的字段为准；[实施状态](docs/node/implementation-status.md)列出了未实现的接口与待联调字段。`docs/` 已放在仓库根目录，与 `src/` 平级。

## 本地启动

需要 Node.js 22、npm 和 Docker Compose。

```bash
cp .env.example .env
docker compose up -d postgres redis
npm ci
npm run db:migrate
npm run db:seed:dev
npm run dev:api
```

另开终端启动异步任务 worker：

```bash
npm run dev:worker
```

种子账号为 `demo_alice` 和 `demo_bob`，默认开发密码为 `Local-demo-123!`；可在运行种子前设置 `DEV_SEED_PASSWORD`。种子只允许在非生产环境运行，重复运行不会重置已有余额。开发模拟供应商必须显式设置 `DEV_MOCK_EXTERNALS=true`。短信模拟验证码取自 `DEV_SMS_CODE`；模拟生成结果包含 `mock: true` 和 `mock://` URL，不能作为真实媒体使用。

## 常用命令

| 命令                                     | 用途                                                      |
| ---------------------------------------- | --------------------------------------------------------- |
| `npm run db:migrate`                     | 对空 PostgreSQL 执行版本化 SQL 迁移                       |
| `npm run db:seed:dev`                    | 创建开发用户、团队、两张画布和两种模型模式                |
| `npm run dev:api` / `npm run dev:worker` | 分别运行 API/WS 与 BullMQ worker                          |
| `npm run openapi:generate`               | 重新生成 `openapi/openapi.json`                           |
| `npm run check`                          | 格式、lint、类型检查与无数据库 HTTP 测试                  |
| `npm run test:integration`               | PostgreSQL 集成测试；需迁移、种子及 `TEST_DATABASE_URL=1` |
| `npm run build` / `npm start`            | 编译并启动 API；worker 可运行 `node dist/worker.js`       |

类型检查和 CI 测试门禁的执行范围、并行任务及远端分支保护设置见 [质量门禁说明](docs/node/quality-gates.md)。CI 从 [.nvmrc](.nvmrc) 读取 Node.js 22；本地运行 `nvm use` 可切换到同一版本。

正式接口文档可从 `GET /openapi.json` 获取。示例登录及画布请求：

```bash
curl -s http://localhost:3000/api/login/password \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo_alice","password":"Local-demo-123!"}'

curl -s http://localhost:3000/api/drama \
  -H 'Authorization: Bearer <access_token>'
```

Alice 首次登录的活跃账号是个人账号。要操作种子团队画布，先调用 `GET /api/account` 取得团队 `account_id`，再用 `POST /api/account/change` 切换并使用响应中的新 token。旧 access/refresh token 随即失效。

## 首页与登录注册

`GET /api/home/carousel` 允许匿名访问，读取已发布且在展示期内的轮播配置，返回 `data.list`、`data.total`；无已发布内容时列表为空。运行 `npm run db:migrate` 后可向 `home_carousels` 写入内容，当前没有管理后台、导入流程或正式轮播素材。`GET /api/home/init` 需要 access token，当前返回 `data.model_enabled`，仅在显式开发模拟已开启且模拟模型能力可用时为 `true`。这两个响应的完整前端字段仍待 Nuxt 源码或接口样本确认。

规格中的注册由 `POST /api/login/sms` 完成：首次验证手机号时，服务端在同一事务中创建用户、个人账号和零余额钱包，然后返回 access/refresh token。先用 `{ "mobile": "13800138000", "sendType": "login_register" }` 调用 `POST /api/sms/send`，再用 `{ "mobile": "13800138000", "captcha": "123456" }` 调用 `POST /api/login/sms`。本地示例需显式启用 `DEV_MOCK_EXTERNALS=true`、`DEV_SMS_CODE=123456`；验证码不会出现在 HTTP 响应中。每个手机号 60 秒内只能发送一次，24 小时内最多 10 次，验证码 5 分钟过期且只能使用一次。`POST /api/login/password` 和 Bearer refresh token 的 `POST /api/auth/refresh` 继续可用；未接入微信平台时，合法 `POST /api/login/wechat` 请求返回 503。

## 项目回收站

`POST /api/drama` 接受 `{ "parent_id": 0, "is_group": false }`；短剧创建成功后同时返回 `drama_id,canvas_id`，项目组 `is_group:true` 只返回 `drama_id`。`GET /api/drama` 支持 `page,limit,parent_id,name,all` 筛选；`all=1` 为项目组，`all=2` 为项目。`PUT /api/drama` 接受 `{ "drama_id": 1, "title": "新标题" }` 或 `{ "drama_id": 1, "cover_image": "..." }`，封面必须是当前账号已登记的图片资产。

`DELETE /api/drama`、`POST /api/project/recycle/restore`、`DELETE /api/project/recycle` 均使用 `{ "ids": [1, 2] }`。软删除使画布从普通读取和新生成入口隐藏；项目组操作会包含其子项目。`GET /api/project/recycle` 支持 `page,limit,name,type`，仅列出当前账号已删除项目。删除和恢复仅限所有者或管理员；仍有进行中任务时，永久删除返回 409。永久删除保留任务及积分审计记录，任务的已删除画布和节点引用变为 `null`。项目请求形状已对照本机 AImanju 前端调用；剧本回收站和真实 OSS 上传仍待实现。

`POST /api/drama/move` 使用 `{ "action": "transfer", "drama_id": 1, "target_id": 2 }` 或 `{ "action": "remove", "drama_id": 1 }`；`/api/drama/batchMove` 将 `drama_id` 换为 `ids`。`POST /api/drama/merge` 使用 `{ "ids": [1, 2] }` 合并同一层级短剧，`POST /api/drama/untie` 使用 `{ "ids": [3] }` 解除项目组并保留子项目。`GET /api/drama/subset` 返回当前账号平铺的短剧列表，支持可选 `page,limit`。项目树修改按账号串行执行，避免移动与删除并发时误删已移出的项目。

## 目录结构

`src/` 根目录保留应用入口、模块装配和共用的配置、数据库、异常及日志；业务代码按功能放在 `src/features/`：

```text
src/
  app.module.ts           # 装配控制器与服务
  main.ts                 # API 进程入口
  worker.ts               # 任务进程入口
  config.ts               # 环境配置
  database.ts             # PostgreSQL 连接与事务
  common.ts / logger.ts   # HTTP 通用处理与日志
  features/
    auth/                  # 登录、会话、鉴权
    accounts/              # 账号信息与切换
    credits/               # 积分查询
    projects/              # 短剧、项目组、回收站
    canvas/                # 画布、节点、连线、批量保存
    generation/            # 模型能力、询价、任务与扣费
    collaboration/         # WebSocket 房间与锁
    home/                  # 首页配置与轮播
    health/                # 健康检查
    integrations/          # 未接入外部服务的明确错误
    system/                # OpenAPI 文档路由
```

功能目录中的 `*.controller.ts` 处理路由和输入，`*.service.ts` 处理业务与数据库事务，`*.schemas.ts` 保存运行时校验。数据库迁移、开发脚本、接口文档和测试分别位于根目录的 `migrations/`、`scripts/`、`openapi/`、`test/`。当前由 `app.module.ts` 集中装配依赖；新增业务应先归入对应功能目录。

## 架构与协议

- NestJS/Fastify 处理 HTTP；原生 `ws` 使用 `{type,data}` 消息，并在连接后发送 `connect.data.client_id`。`POST /api/team/join` 用该 ID 加入画布。
- PostgreSQL 是账号、画布版本、任务意图、积分账本和 outbox 的真源。`POST /api/node/batch` 锁画布版本行，整批校验并在一个事务内保存图和事件。个人视口 `PUT /api/drama/canvas/{id}` 不增加图版本。
- 生成受理将幂等意图、子任务、扣费和 outbox 放在同一事务。worker 将 outbox 投递 BullMQ；Redis 队列只承担执行，不作为幂等真源。`request_id` 未提供时服务端生成 ID，但此时客户端超时重试无法获得跨请求强幂等保证。
- 开发模式使用模拟 AI 和短信适配器。生产缺少真实供应商、OSS 或支付接入时相关路由返回明确的 503。订单不会由浏览器请求标记为已支付。
- WebSocket 连接使用 URL query token，网关不记录 query 内容。画布锁使用 Redis 15 秒租约；提交后的图事件从 outbox 发布，持久 `canvas_events` 可供版本重同步。

环境变量见 [.env.example](.env.example)。生产必须设置不同的强 `ACCESS_TOKEN_SECRET` 与 `REFRESH_TOKEN_SECRET`、`DATABASE_URL`、`REDIS_URL`、HTTPS/WSS 的 `PUBLIC_API_ORIGIN`/`PUBLIC_WS_ORIGIN`，以及明确的 HTTPS `ALLOWED_WEB_ORIGINS` 和 `WS_ALLOWED_ORIGINS`，并关闭 `DEV_MOCK_EXTERNALS`。HTTP 请求体上限为 1 MiB；节点 `extra_data` 上限为 16 KiB，批量和任务数量也有配置上限。日志只记录请求方法、路径（不含 query）、状态、耗时和请求 ID。

部署时将 `/api/media/*` 保持路由到现有 Nuxt Nitro 媒体代理，将其他 `/api/*` 路由到本服务，并为 WebSocket 连接配置 upgrade。API 与 worker 应分别部署。当前项目使用版本化 PostgreSQL SQL 迁移与 `pg` 事务；规格中的 Prisma 是建议选型，现有实现以事务和外部协议为优先。

## 验证范围

`npm run check` 与 `npm run build` 可在没有外部服务时运行。CI 在 PostgreSQL 16、Redis 7 容器上执行迁移、种子和 `npm run test:integration`，覆盖登录/刷新/账号切换、账号隔离、画布冲突与回滚、积分扣费与生成幂等。真实 Nuxt 客户端、支付、OSS、微信、短信和模型厂商仍需单独联调；具体缺口见[实施状态](docs/node/implementation-status.md)。
