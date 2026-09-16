import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';
import { loadConfig, type AppConfig } from './config';
import { createLogger } from './logger';
import healthRouter from './routes/health';

export type RouteRegistrar = (app: Express) => void;

export interface AppOptions {
  readonly config?: AppConfig;
  readonly logger?: Logger;
  readonly registerRoutes?: RouteRegistrar;
}

const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: 'Not Found' });
};

function getErrorType(error: unknown): string | undefined {
  if (error instanceof Error && 'type' in error && typeof error.type === 'string') {
    return error.type;
  }

  return undefined;
}

function createRequestId(rawRequestId: unknown): string {
  if (typeof rawRequestId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(rawRequestId)) {
    return rawRequestId;
  }

  return randomUUID();
}

export function createApp(options: AppOptions = {}): Express {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config);
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId(request, response) {
        const requestId = createRequestId(request.headers['x-request-id']);
        response.setHeader('X-Request-Id', requestId);
        return requestId;
      },
      customProps(request) {
        return { requestId: request.id };
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, origin !== undefined && config.corsOrigins.includes(origin));
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use('/health', healthRouter);
  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const requestLogger = request.log ?? logger;
    const errorType = getErrorType(error);

    if (errorType === 'entity.too.large') {
      requestLogger.warn(
        { err: error, requestId: request.id },
        'Request body exceeds the configured limit',
      );
      response.status(413).json({ error: 'Payload Too Large' });
      return;
    }

    if (errorType === 'entity.parse.failed') {
      requestLogger.warn({ err: error, requestId: request.id }, 'Request contains invalid JSON');
      response.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    requestLogger.error({ err: error, requestId: request.id }, 'Unhandled request error');
    response.status(500).json({ error: 'Internal Server Error' });
  };
  app.use(errorHandler);

  return app;
}
