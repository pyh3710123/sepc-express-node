# TypeScript 与 CI 质量门禁

本项目使用 Node.js 22、TypeScript strict 和两层测试。目标是在合并前同时验证源码类型、脚本与测试类型、无数据库 HTTP 行为，以及 PostgreSQL/Redis 上的业务行为。

## 类型检查边界

- `.nvmrc` 固定开发和 CI 使用的 Node.js 主版本 22；`package.json` 的 `engines.node` 要求至少 22。
- `tsconfig.json` 的 `strict: true` 作用于生产 `src/**/*.ts`，`npm run build` 用它编译 `dist/`。
- `tsconfig.check.json` 继承同一严格配置，额外纳入 `scripts/**/*.ts` 与 `test/**/*.ts`；`npm run typecheck` 使用 `--noEmit`，因此测试和迁移脚本不会漏出类型门禁。
- HTTP 输入需要运行时校验。类型检查无法证明外部 JSON 合法；控制器仍应先用 Zod 校验，再交给服务。

## CI 任务

| 任务           | 执行内容                                                                  | 失败时                   |
| -------------- | ------------------------------------------------------------------------- | ------------------------ |
| `static`       | `npm ci`、格式、ESLint、严格类型检查、OpenAPI 一致性、生产构建            | 阻止汇总门禁通过         |
| `unit`         | `npm ci`、`npm test`；运行 `test/*.test.ts`                               | 阻止汇总门禁通过         |
| `integration`  | 启动 PostgreSQL 16 和 Redis 7，迁移、开发种子、`npm run test:integration` | 阻止汇总门禁通过         |
| `quality-gate` | 无条件汇总前三项；失败、取消或跳过任一项都返回失败                        | 作为远端唯一必需状态检查 |

三项验证并行运行，数据库服务只属于 `integration` 任务。`test:integration` 需要 `TEST_DATABASE_URL=1` 才会启动；CI 明确设置该值，避免把未运行的集成测试当作通过。开发模拟凭证只用于 CI 测试，不代表已接入真实短信、模型或其他外部平台。

## 本地执行

```bash
nvm use
npm ci
npm run check
npm run build
```

`npm run check` 包含格式、lint、严格类型检查、OpenAPI 检查和无数据库测试。需要复现 CI 集成任务时，先按 [README](../../README.md) 启动 PostgreSQL 与 Redis、运行迁移及种子，再执行：

```bash
TEST_DATABASE_URL=1 npm run test:integration
```

## 远端合并限制

工作流文件为 `.github/workflows/ci.yml`，不设置路径过滤，因此文档变更也会产生检查状态。首次推送并确认 GitHub Actions 实际运行后，在仓库的 `main` 分支保护或 ruleset 中启用「Require a pull request before merging」及「Require status checks to pass before merging」，将 **`quality-gate`** 设为必需检查，并按团队权限策略关闭绕过。仅添加工作流文件不会自动启用分支保护；在远端完成设置前，CI 失败仍可能被合并。

GitHub 对依赖任务、`always()` 和必需状态的说明见 [工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)与[受保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)。
