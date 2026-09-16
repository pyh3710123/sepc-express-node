import 'dotenv/config';
import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './logger';

const config = loadConfig();
const logger = createLogger(config);
const app = createApp({ config, logger });
const server = app.listen(config.port, config.host, () => {
  const address = server.address();
  const listeningPort =
    typeof address === 'object' && address !== null ? address.port : config.port;

  logger.info({ host: config.host, port: listeningPort }, 'Express server listening');
});

server.on('error', (error: Error) => {
  logger.fatal({ err: error, host: config.host, port: config.port }, 'HTTP server failed');
  process.exitCode = 1;
});

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Shutdown requested');

  server.close((error?: Error) => {
    if (error) {
      logger.error({ err: error, signal }, 'Failed to close HTTP server');
      process.exitCode = 1;
      return;
    }

    logger.info({ signal }, 'HTTP server closed');
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
