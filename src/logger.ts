import pino from 'pino';
import type { AppConfig } from './config';

/** 创建带服务标识、ISO 时间戳和敏感字段脱敏规则的结构化日志器。 */
export function createLogger(config: AppConfig): ReturnType<typeof pino> {
  return pino({
    level: config.logLevel,
    base: { service: 'aimanju-backend', environment: config.nodeEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.proxy-authorization',
        'req.headers.x-api-key',
        'res.headers.set-cookie',
      ],
      censor: '[REDACTED]',
    },
  });
}
