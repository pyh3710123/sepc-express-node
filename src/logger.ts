import pino, { type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from './config';

export function createLogger(config: AppConfig, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.logLevel,
      base: {
        service: 'express-node-service',
        environment: config.nodeEnv,
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.proxy-authorization',
          'req.headers.cookie',
          'req.headers.set-cookie',
          'req.headers.x-api-key',
          'res.headers.set-cookie',
        ],
        censor: '[REDACTED]',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
