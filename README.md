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

正式接口文档可从 `GET /openapi.json` 获取。示例登录及画布请求：

```bash
curl -s http://localhost:3000/api/login/password \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo_alice","password":"Local-demo-123!"}'

curl -s http://localhost:3000/api/drama \
  -H 'Authorization: Bearer <access_token>'
```

Alice 首次登录的活跃账号是个人账号。要操作种子团队画布，先调用 `GET /api/account` 取得团队 `account_id`，再用 `POST /api/account/change` 切换并使用响应中的新 token。旧 access/refresh token 随即失效。

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
