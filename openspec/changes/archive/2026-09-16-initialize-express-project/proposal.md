## Why

当前仓库只有 OpenSpec 配置，没有可运行的 Node.js 应用基础。现在建立统一、可验证的 Express 服务骨架，可以为后续业务功能提供明确的启动入口、路由组织方式和最小健康检查。

## What Changes

- 创建基于 npm 的 Node.js TypeScript 项目，并将 TypeScript 编译为可运行的 CommonJS 输出。
- 引入 Express 作为运行时依赖，提供 `build`、`start` 和本地开发启动脚本。
- 增加可独立测试的 Express app 工厂和 HTTP server 启动入口。
- 增加 `GET /health` 健康检查接口，返回稳定的 JSON 响应。
- 增加基础的 404/错误 JSON 响应和健康检查测试。
- 增加 TypeScript 编译配置、项目 README、`.gitignore` 和 Node.js 版本约束，明确基础使用方式。

## Capabilities

### New Capabilities

- `express-app-foundation`: 提供可启动、可测试的 Express 应用基础，包括启动脚本、健康检查和基础 HTTP 错误响应。

### Modified Capabilities

无。

## Impact

- 新增 Node.js 项目清单、TypeScript 编译配置、锁文件、`src/` 应用代码和测试代码。
- 新增 Express 运行时依赖，以及 TypeScript、Express 类型定义和测试所需的开发依赖。
- 暂不引入数据库、认证、业务领域路由、环境变量管理或部署配置。
