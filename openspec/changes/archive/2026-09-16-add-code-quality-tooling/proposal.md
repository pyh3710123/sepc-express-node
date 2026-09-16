## Why

项目已经能够运行 TypeScript 和 Express，但目前没有自动化的格式、静态检查和完整类型检查规则。现在建立统一的本地检查入口，可以让开发者和 AI 在提交代码前得到一致反馈，减少风格漂移和低级错误。

## What Changes

- 增加 ESLint TypeScript 配置，检查源码和测试代码。
- 增加 Prettier 配置，统一 TypeScript、JSON、Markdown 和配置文件格式。
- 增加完整的类型检查、Lint、格式检查和组合检查 npm 命令。
- 将 Node.js、TypeScript、Express、目录约定和代码分层原则写入 OpenSpec 项目 context。
- 保持运行时 API 和现有业务行为不变。

## Capabilities

### New Capabilities

无。本变更只涉及开发工具和项目约束，已通过 `.openspec.yaml` 的 `skip_specs: true` 声明不产生 spec-level 行为变化。

### Modified Capabilities

无。

## Impact

- 新增 ESLint、Prettier 及 TypeScript ESLint 相关开发依赖和配置文件。
- 更新 `package.json` 脚本和 OpenSpec `config.yaml` context。
- 不改变 HTTP 接口、运行时依赖或生产启动行为。
