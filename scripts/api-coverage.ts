import 'reflect-metadata';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import ts from 'typescript';
import { AppModule } from '../src/app.module';

interface ContractSource {
  file: string;
  line: number;
}

interface ContractOperation {
  method: string;
  path: string;
  sources: ContractSource[];
}

const SNAPSHOT_PATH = resolve('docs/node/frontend-api-snapshot.json');
const METHODS = new Map<number, string>([
  [RequestMethod.GET, 'GET'],
  [RequestMethod.POST, 'POST'],
  [RequestMethod.PUT, 'PUT'],
  [RequestMethod.DELETE, 'DELETE'],
  [RequestMethod.PATCH, 'PATCH'],
]);

/** 将 NestJS 和前端模板路径统一成 OpenAPI 参数形式。 */
function normalizePath(path: string): string {
  return `/${path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
    .replace(/:([A-Za-z_][\w]*)/g, '{$1}')}`;
}

/** 从调用的 options 对象中提取 HTTP 方法。 */
function methodOf(node: ts.CallExpression): string {
  const options = node.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return 'GET';
  const property = options.properties.find(
    (item) => ts.isPropertyAssignment(item) && item.name.getText() === 'method',
  );
  if (!property || !ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer))
    return 'GET';
  return property.initializer.text.toUpperCase();
}

/** 把静态字符串或简单模板串转换为接口路径。 */
function pathOf(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return undefined;
  return node.head.text + node.templateSpans.map((span) => `{id}${span.literal.text}`).join('');
}

/** 递归枚举前端 api 目录中的 TypeScript 源码。 */
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    }),
  );
  return nested.flat();
}

/** 从本机 Nuxt API 模块生成带源码位置的请求清单。 */
async function frontendOperations(frontendRoot: string): Promise<ContractOperation[]> {
  const operations = new Map<string, ContractOperation>();
  for (const path of await sourceFiles(join(frontendRoot, 'api'))) {
    const source = ts.createSourceFile(
      path,
      await readFile(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['request', '$fetch'].includes(node.expression.text)
      ) {
        const rawPath = pathOf(node.arguments[0]);
        if (rawPath && !/^https?:\/\//.test(rawPath)) {
          const method = methodOf(node);
          const apiPath = normalizePath(`api/${rawPath}`);
          const key = `${method} ${apiPath}`;
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const operation = operations.get(key) ?? { method, path: apiPath, sources: [] };
          operation.sources.push({ file: relative(frontendRoot, path), line });
          operations.set(key, operation);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...operations.values()].sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`),
  );
}

/** 不启动依赖服务即可从控制器元数据枚举实际注册的 HTTP 路由。 */
function registeredRoutes(): Set<string> {
  const routes = new Set<string>();
  const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as Array<
    new (...args: never[]) => object
  >;
  for (const controller of controllers) {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as unknown;
      if (typeof handler !== 'function') continue;
      const method = METHODS.get(Reflect.getMetadata(METHOD_METADATA, handler) as number);
      if (!method) continue;
      const localPath = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      routes.add(`${method} ${normalizePath(`${prefix}/${localPath}`)}`);
    }
  }
  return routes;
}

/** 比较前端快照、OpenAPI 和实际路由，并可输出尚未实现的接口。 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf('--frontend-root');
  const frontendRoot = rootFlag >= 0 ? resolve(args[rootFlag + 1]) : undefined;
  if (args.includes('--write')) {
    if (!frontendRoot) throw new Error('--write 需要 --frontend-root');
    const operations = await frontendOperations(frontendRoot);
    await writeFile(SNAPSHOT_PATH, `${JSON.stringify({ operations }, null, 2)}\n`);
    process.stdout.write(`已保存 ${operations.length} 个前端接口操作\n`);
    return;
  }
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')) as {
    operations: ContractOperation[];
  };
  if (frontendRoot) {
    const fresh = await frontendOperations(frontendRoot);
    if (JSON.stringify(fresh) !== JSON.stringify(snapshot.operations))
      throw new Error('前端接口清单已变化，请更新快照');
  }
  const openapi = JSON.parse(await readFile(resolve('openapi/openapi.json'), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const documented = new Set(
    Object.entries(openapi.paths).flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((method) =>
          METHODS.has(RequestMethod[method.toUpperCase() as keyof typeof RequestMethod] as number),
        )
        .map((method) => `${method.toUpperCase()} ${normalizePath(path)}`),
    ),
  );
  const registered = registeredRoutes();
  const missingDocs = [...registered].filter((route) => !documented.has(route));
  const missingRoutes = [...documented].filter((route) => !registered.has(route));
  if (missingDocs.length || missingRoutes.length) {
    process.stderr.write(
      `路由与 OpenAPI 不一致\n未文档化：${missingDocs.join(', ')}\n未注册：${missingRoutes.join(', ')}\n`,
    );
    process.exitCode = 1;
  }
  const pending = snapshot.operations.filter((operation) => {
    const key = `${operation.method} ${operation.path}`;
    return !registered.has(key) || !documented.has(key);
  });
  process.stdout.write(
    `前端 ${snapshot.operations.length} 个接口操作，已覆盖 ${snapshot.operations.length - pending.length} 个，待实现 ${pending.length} 个。\n`,
  );
  if (args.includes('--strict') && pending.length) {
    process.stderr.write(
      pending
        .map(
          (item) => `${item.method} ${item.path} ${item.sources[0]?.file}:${item.sources[0]?.line}`,
        )
        .join('\n') + '\n',
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
