import pino from 'pino';
import type { AppConfig } from './config';

export function createLogger(config: AppConfig) {
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
