import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { ApiErrorFilter, ResponseInterceptor } from './common';
import { APP_CONFIG, type AppConfig } from './config';
import { CollaborationService } from './features/collaboration/collaboration.service';
import { createLogger } from './logger';

/** 构造并初始化 HTTP 应用、全局中间件、过滤器和响应拦截器。 */
export async function createApiApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1024 * 1024, logger: false }),
    { logger: false },
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = createLogger(config);
  await app.register(helmet);
  await app.register(cors, {
    origin: (origin, callback) =>
      callback(null, !origin || config.allowedWebOrigins.includes(origin)),
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook(
      'onRequest',
      async (
        request: { headers: Record<string, unknown> },
        reply: { header: (key: string, value: string) => void },
      ) => {
        const supplied = request.headers['x-request-id'];
        reply.header(
          'X-Request-Id',
          typeof supplied === 'string' && /^[\w.-]{1,128}$/.test(supplied)
            ? supplied
            : randomUUID(),
        );
      },
    );
  app
    .getHttpAdapter()
    .getInstance()
    .addHook(
      'onResponse',
      async (
        request: { method: string; url: string },
        reply: { statusCode: number; getHeader: (key: string) => unknown; elapsedTime: number },
      ) => {
        logger.info(
          {
            method: request.method,
            path: request.url.split('?')[0],
            status_code: reply.statusCode,
            request_id: reply.getHeader('X-Request-Id'),
            duration_ms: reply.elapsedTime,
          },
          'request completed',
        );
      },
    );
  app.useGlobalFilters(new ApiErrorFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** 启动 HTTP 服务并挂载 WebSocket 协作端点与退出清理逻辑。 */
async function main(): Promise<void> {
  const app = await createApiApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  const collaboration = app.get(CollaborationService);
  await collaboration.attach(app.getHttpServer());
  await app.listen(config.port, config.host);
  process.once('SIGTERM', () => void collaboration.close());
  process.once('SIGINT', () => void collaboration.close());
  process.stdout.write(`AImanju API listening on ${config.host}:${config.port}\n`);
}

if (require.main === module)
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
