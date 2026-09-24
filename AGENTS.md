# AImanju 后端 Agent 编码规范

本文件适用于本仓库的 `src/`、`scripts/`、`test/`、数据库迁移和接口文档。命名、中文注释和 TypeScript 约定参考 AImanju 前端仓库根目录的 `AGENTS.md`；以下规则按本项目的 NestJS/Fastify 后端结构编写。新增或修改代码时遵守本文件，不为统一旧代码风格而进行无关重构。

## 1. 命名与格式

- 变量、参数、函数和类方法使用 `camelCase`，名称表达业务用途，例如 `accountId`、`createSession`。类型、接口、类使用 `PascalCase`，例如 `Identity`、`AuthService`。
- 模块顶层的固定配置、协议版本、阈值和键名使用 `UPPER_SNAKE_CASE`，例如 `SMS_SEND_COOLDOWN_SECONDS`。局部 `const` 仍使用 `camelCase`。
- HTTP 请求/响应字段、数据库列名和环境变量保留既有契约的 `snake_case` / `UPPER_SNAKE_CASE`；在业务逻辑中需要不同命名时，明确转换，不为了代码风格改动外部协议。
- 避免 `tmp`、`data1`、`fn1` 等无意义名称和匈牙利前缀。沿用本仓库 Prettier、ESLint 和 TypeScript strict 配置；不要套用前端项目的无分号或 Vue 文件格式。
- 使用 `import type` 导入纯类型。输入暂时未知时用 `unknown` 并在边界校验；不以 `any`、无依据的类型断言或忽略指令绕过类型检查。

## 2. 中文注释

- 新增的导出函数、重要导出常量、服务的对外方法，以及复杂业务变量，应有简洁中文注释，说明用途、调用时机或非显然的返回值。
- 权限判断、事务边界、幂等处理、并发锁、补偿逻辑和与前端协议有关的约束，应在关键位置说明**为什么这样处理**。注释中的接口字段和状态必须与实现一致。
- 不写逐行翻译代码的注释，例如“定义变量”“查询数据库”“返回结果”。修改行为时同步修正过时注释；能用清楚的命名表达的简单逻辑无需重复注释。
- 对外方法优先使用 `/** ... */`，局部关键分支可用 `// ...`。代码标识符和协议字段保持原文，其余说明使用中文。

## 3. 函数写法

- 模块级可复用逻辑优先使用具名 `function` / `async function`；NestJS 控制器和服务使用类方法；简短的 `map`、`filter`、事务回调可以使用箭头函数。不要把重要业务流程藏在匿名回调中。
- 一个函数承担一个清楚的职责。控制器负责路由、鉴权上下文和输入校验，业务规则放在服务中，数据库读写放在服务或数据访问层；必要时把较长流程拆成有业务含义的私有方法。
- 导出函数、服务对外方法及跨层调用应明确参数和返回类型，异步函数写明 `Promise<T>`。无效输入和不可继续的状态使用提前返回或抛出明确错误，减少嵌套。
- HTTP body、query、path 参数先做运行时校验，再传给服务。保持现有 `{ code, message, data }` 响应和全局异常过滤器；不要用空成功值掩盖失败，也不要在控制器里散落 `try/catch` 吞掉错误。
- 账号身份来自已验证的服务端会话。SQL 使用参数化查询；涉及多表状态或扣费的操作使用事务。配置统一从 `src/config.ts` 获取，不在业务函数里直接读取 `process.env`。

```typescript
/** 单个手机号每分钟只允许发送一次验证码。 */
const SMS_SEND_COOLDOWN_SECONDS = 60;

/** 校验输入并返回可安全用于查询的画布 ID。 */
export function parseCanvasId(value: unknown): number {
  return parse(z.coerce.number().int().positive(), value);
}

@Injectable()
export class CanvasService {
  /** 按当前会话的账号读取画布；无权限时返回统一的资源不存在错误。 */
  async getCanvas(identity: Identity, canvasId: number): Promise<CanvasDetail> {
    // 查询必须同时限制画布 ID 与当前账号，避免通过猜测 ID 读取其他账号的数据。
    return this.findOwnedCanvas(identity.accountId, canvasId);
  }
}
```

示例用于说明命名、注释和函数形态，不是可直接复制的完整模块；实际代码需补齐导入和具体类型。

## 4. 变更与验证

- 业务契约以 `docs/node/backend-generation-spec.md` 和已实现的 `openapi/openapi.json` 为准；前端源码或真实调用样本存在冲突时，先记录差异，再更新实现与 OpenAPI。缺少外部凭证时返回明确不可用错误，开发模拟必须显式启用。
- 行为变更补充能验证结果和边界条件的测试；数据库、并发和账号隔离行为优先放在 `test/integration/`。只改文档或简单格式时无需新增测试。
- 代码改动完成后运行 `npm run check` 和 `npm run build`。两条命令都遵循 `tsconfig.json` 的 `strict: true`，其中 `npm run typecheck` 还覆盖脚本和测试。数据库集成测试需要 PostgreSQL、Redis、迁移、种子和 `TEST_DATABASE_URL=1`；未运行的测试须如实说明，不把编译或模拟测试视为真实第三方联调。CI 任务与必需状态见 `docs/node/quality-gates.md`。
