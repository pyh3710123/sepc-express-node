import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config';

test('loadConfig applies the documented defaults', () => {
  assert.deepEqual(loadConfig({}), {
    nodeEnv: 'development',
    host: '0.0.0.0',
    port: 3000,
    logLevel: 'info',
    corsOrigins: [],
  });
});

test('loadConfig normalizes custom values and CORS origins', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '4000',
    LOG_LEVEL: 'warn',
    CORS_ORIGINS: ' https://example.com/,http://localhost:5173 ',
  });

  assert.deepEqual(config, {
    nodeEnv: 'production',
    host: '127.0.0.1',
    port: 4000,
    logLevel: 'warn',
    corsOrigins: ['https://example.com', 'http://localhost:5173'],
  });
});

test('loadConfig rejects invalid runtime values and CORS URLs', () => {
  const invalidEnvironments = [
    { PORT: 'not-a-port' },
    { PORT: '65536' },
    { NODE_ENV: 'staging' },
    { HOST: '   ' },
    { LOG_LEVEL: 'verbose' },
    { CORS_ORIGINS: 'https://example.com/api' },
    { CORS_ORIGINS: 'file://example.com' },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(() => loadConfig(environment), /Invalid environment configuration/);
  }
});
