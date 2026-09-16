# express-app-foundation Specification

## Purpose
为项目提供一个可直接启动、可独立测试且具有稳定基础 HTTP 行为的 Express 应用骨架，作为后续业务功能开发的运行基础。

## Requirements

### Requirement: Project provides a runnable HTTP service

项目 SHALL 提供一个标准的 `npm start` 命令来启动 HTTP 服务。服务 SHALL 使用 `PORT` 环境变量指定端口；当 `PORT` 未设置时 SHALL 使用端口 `3000`。

#### Scenario: Start service with the default port

- **WHEN** 用户在未设置 `PORT` 的情况下执行 `npm start`
- **THEN** 项目 SHALL 启动 HTTP 服务并监听端口 `3000`

#### Scenario: Start service with a custom port

- **WHEN** 用户设置有效的 `PORT` 值后执行 `npm start`
- **THEN** 项目 SHALL 启动 HTTP 服务并监听该端口

### Requirement: Service exposes a health check

服务 SHALL 提供 `GET /health` 接口。请求成功时 SHALL 返回 HTTP 状态码 `200`、`application/json` 内容类型，以及 JSON 响应 `{ "status": "ok" }`。

#### Scenario: Health check succeeds

- **WHEN** 客户端向 `/health` 发送 GET 请求
- **THEN** 服务 SHALL 返回状态码 `200` 和 `status` 值为 `ok` 的 JSON 响应

### Requirement: Service returns a JSON response for unknown routes

当请求路径没有匹配的路由时，服务 SHALL 返回 HTTP 状态码 `404` 和 JSON 响应 `{ "error": "Not Found" }`。

#### Scenario: Unknown route is requested

- **WHEN** 客户端请求一个未注册的路径
- **THEN** 服务 SHALL 返回状态码 `404`、JSON 内容类型和 `error` 值为 `Not Found` 的响应

### Requirement: Service returns a safe JSON response for unexpected errors

当服务处理请求时发生未预期错误，服务 SHALL 返回 HTTP 状态码 `500` 和 JSON 响应 `{ "error": "Internal Server Error" }`，且响应 SHALL 不包含堆栈信息。

#### Scenario: Unexpected request error occurs

- **WHEN** 已注册路由在处理请求时产生未预期错误
- **THEN** 服务 SHALL 返回状态码 `500` 和通用错误 JSON 响应，且不向客户端暴露错误堆栈

### Requirement: Project provides a repeatable test command

项目 SHALL 提供一个标准的 `npm test` 命令，用于自动验证基础 HTTP 行为，并在测试失败时返回非零退出码。

#### Scenario: Baseline tests pass

- **WHEN** 用户执行 `npm test`
- **THEN** 健康检查和基础错误响应测试 SHALL 执行成功并返回零退出码
