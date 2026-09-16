# Express Node Service

一个基于 TypeScript 和 Express 5 的 Node.js 服务骨架，包含经过校验的环境配置、基础 HTTP 安全策略、结构化日志和自动化质量检查。

## 环境要求

- Node.js 20 或更高版本
- npm

## 安装

```bash
npm ci
cp .env.example .env
```

## 常用命令

```bash
# TypeScript 编译到 dist/
npm run build

# 本地开发，源码变更后自动重启
npm run dev

# 编译并启动服务
npm start

# 运行 HTTP 契约测试
npm test

# 格式、lint、类型检查和测试
npm run check
```

服务配置集中在 `src/config.ts`，启动前会校验环境变量。`.env` 不会提交到版本库；可配置项如下：

| 变量           | 默认值        | 说明                                       |
| -------------- | ------------- | ------------------------------------------ |
| `NODE_ENV`     | `development` | 仅允许 `development`、`test`、`production` |
| `HOST`         | `0.0.0.0`     | HTTP 监听地址                              |
| `PORT`         | `3000`        | 0–65535 的整数；`0` 可让系统分配端口       |
| `LOG_LEVEL`    | `info`        | Pino 日志级别                              |
| `CORS_ORIGINS` | 空            | 逗号分隔的精确 HTTP(S) origin 白名单       |

例如：

```bash
CORS_ORIGINS=http://localhost:5173,https://app.example.com
```

空的 `CORS_ORIGINS` 表示不允许浏览器跨域访问；同源请求和非浏览器客户端不受影响。不要在 origin 后添加路径或使用通配符。

## HTTP 基础防护与日志

- 响应启用 Helmet 安全头，并移除 `X-Powered-By`。
- JSON 请求体最大为 100 KB；无效 JSON 返回 `400 { "error": "Invalid JSON" }`，超限返回 `413 { "error": "Payload Too Large" }`。
- 请求会获得 `X-Request-Id`；请求、启动、关闭和服务端错误以 JSON 结构化日志写入标准输出。
- 日志会脱敏 Authorization、Cookie、Set-Cookie、Proxy-Authorization 和 X-API-Key 请求头，以及响应的 Set-Cookie。不要把敏感值放进 URL 查询参数。

## API

### `GET /health`

服务健康检查接口，成功时返回：

```json
{
  "status": "ok"
}
```

未匹配的路径返回 `404` JSON，未预期错误返回 `500` JSON。

新增业务 API 统一放在 `/api/v1` 下；`/health` 保持为顶层存活检查接口。

## 项目结构

```text
src/
├── app.ts
├── config.ts
├── logger.ts
├── server.ts
└── routes/
    └── health.ts
test/
├── app.test.ts
└── config.test.ts
```

GitHub Actions 会在 push 和 pull request 上运行 `npm ci`、`npm run check` 和 `npm run build`。
