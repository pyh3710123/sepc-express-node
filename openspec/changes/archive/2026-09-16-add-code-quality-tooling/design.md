## Context

项目已有 TypeScript + Express 基础服务、`tsconfig.json`、Node 内置测试和 Supertest，但只有编译与测试命令，没有统一的风格或静态检查入口。本变更只增加开发时的质量门禁，不改变运行时代码行为。

## Goals / Non-Goals

**Goals:**

- 对 `src/` 和 `test/` 下的 TypeScript 文件执行 ESLint 检查。
- 使用 Prettier 统一源码、配置和 README 格式。
- 让 `npm run check` 一次执行格式检查、Lint、完整类型检查和测试。
- 让后续 AI 生成的 OpenSpec artifacts 获得稳定的项目技术背景与代码约定。

**Non-Goals:**

- 不改变 API、路由、错误响应或生产启动流程。
- 不加入特定 CI 平台、Git hooks 或提交信息校验。
- 不引入复杂的 ESLint 插件体系或业务领域规则。

## Decisions

- **使用 ESLint flat config。** 采用 ESLint 9 推荐的 `eslint.config.mjs`，组合 JavaScript 推荐规则、TypeScript ESLint 推荐规则和 Prettier 兼容配置；这样配置集中且不需要旧版 `.eslintrc` 兼容层。
- **使用 TypeScript ESLint 的非类型感知推荐规则。** 类型正确性由 `tsc` 负责，ESLint 负责代码问题和 TypeScript 语法规则，避免每次 lint 建立额外的类型程序服务。
- **使用 Prettier 作为唯一格式化来源。** 统一使用分号、单引号、尾逗号和 100 列宽；ESLint 通过 `eslint-config-prettier` 关闭冲突格式规则。
- **增加独立的全量检查配置。** 保留现有 `tsconfig.json` 负责生产构建，新增 `tsconfig.check.json` 覆盖 `src/` 和 `test/`，让 `npm run typecheck` 同时检查测试代码。
- **组合检查命令作为提交前入口。** `npm run check` 依次执行 `format:check`、`lint`、`typecheck` 和 `test`；自动修复使用 `npm run format`，Lint 只报告问题，不默认修改源码。
- **将项目约定写入 OpenSpec context。** `context` 记录技术栈、目录、严格类型、分层、错误处理和验证命令；这些内容用于指导 AI，不替代 ESLint、Prettier 或 TypeScript 的执行检查。

## Risks / Trade-offs

- [工具版本持续变化] → 使用 npm lockfile 锁定实际版本，并通过 `npm run check` 验证升级影响。
- [现有文件可能不符合新格式] → 先运行 `npm run format` 统一当前项目文件，再运行检查命令。
- [规则过严阻碍早期开发] → 先采用官方推荐规则和少量明确约束，业务规则在出现真实需求后单独调整。
- [本地检查不等于 CI 门禁] → 当前不绑定 CI 平台；后续可把 `npm run check` 接入任意 CI 任务。

## Migration Plan

安装新增开发依赖，加入配置和 npm scripts，格式化现有源码后运行 `npm run check`。若工具链需要回滚，移除新增配置和开发依赖即可，不影响生产 API 或运行方式。
