## Context

仓库当前只有 OpenSpec 配置和技能文件，没有源码、依赖清单或测试框架。设计需要保持启动路径清晰，并让 HTTP 应用可以在不占用真实端口的情况下被测试。

## Goals / Non-Goals

**Goals:**

- 建立一个使用 Express 的最小可运行 Node.js TypeScript 服务。
- 将应用构造和 HTTP server 启动分离，支持快速、隔离的接口测试。
- 为后续扩展预留清晰的 `src/`、路由和测试目录结构。
- 提供开发、生产启动和测试的标准 npm 命令。

**Non-Goals:**

- 不加入数据库、认证、业务领域模型或 API 版本管理。
- 不加入容器、部署平台、日志平台或复杂配置系统。
- 不在本次初始化中定义除健康检查以外的业务接口。

## Decisions

- **使用 TypeScript + CommonJS 输出。** 用户明确要求 TypeScript；使用严格类型检查并编译为 CommonJS，避免生产环境依赖运行时转译，且不引入 ESM 扩展名和构建路径的额外复杂度。
- **使用 Express 作为唯一运行时 Web 框架。** 将 Express 作为运行时依赖，并锁定实际安装版本到 `package-lock.json`；不额外引入未要求的框架层。
- **拆分 `app` 工厂与 `server` 入口。** `src/app.ts` 负责创建并配置 Express 应用，`src/server.ts` 负责读取端口并监听。生产通过 `tsc` 将源码输出到 `dist/` 后运行；测试直接加载 app，避免每个测试都启动持久监听器。
- **采用按职责分层的最小结构。** 健康路由放在 `src/routes/health.ts`，错误处理在 app 装配层统一完成，测试放在 `test/`。
- **使用 Node 内置测试运行器配合 Supertest。** `node:test` 不需要额外测试框架；通过 `tsx` 执行 TypeScript 测试，Supertest 用于直接验证 Express 的状态码、内容类型和 JSON 响应。
- **提供 `build`、`dev`、`start` 和 `test` 脚本。** `build` 使用 `tsc` 生成 `dist/`，`dev` 使用 `tsx watch` 直接运行源码并监听变更，`start` 运行编译后的 JavaScript，`test` 使用 `tsx` 配合 Node 内置测试运行器。
- **端口策略固定为 `PORT` 或 `3000`。** 启动入口解析环境变量并使用默认端口，便于本地运行和后续部署平台注入端口。

## Risks / Trade-offs

- [Node.js/TypeScript 版本差异] → 在 `package.json` 中声明 Node.js `>=20`，固定 TypeScript 配置，并在 README 中记录要求。
- [依赖安装依赖 npm registry] → 提交 `package-lock.json`，安装完成后用 `npm test` 验证依赖和行为。
- [错误响应过于通用] → 当前仅保护客户端响应不泄露堆栈；详细日志和结构化错误处理留给后续需求。
- [开发 watch 模式的进程管理差异] → `dev` 仅作为本地便利命令，生产和自动化验证使用 `build`、`start` 与 `test`。

## Migration Plan

这是一个空仓库的首次初始化，不涉及旧接口或数据迁移。完成文件和依赖安装后，依次运行 `npm test` 和 `npm start` 验证；若需要回滚，只需移除本次新增的项目文件和依赖变更。
