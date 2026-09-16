import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import pino, { type Logger } from 'pino';
import request from 'supertest';
import { createApp, type AppOptions } from '../src/app';
import { loadConfig } from '../src/config';
import { createLogger } from '../src/logger';

function createTestApp(options: Omit<AppOptions, 'logger'> = {}): ReturnType<typeof createApp> {
  return createApp({ ...options, logger: pino({ level: 'silent' }) });
}

function createCapturingLogger(records: Array<Record<string, unknown>>): Logger {
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      try {
        records.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error('Unable to parse log record'));
      }
    },
  });

  return createLogger(loadConfig({ LOG_LEVEL: 'trace' }), destination);
}

test('GET /health returns a healthy JSON response with security headers', async () => {
  const response = await request(createTestApp()).get('/health');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('unknown routes return a JSON 404 response', async () => {
  const response = await request(createTestApp()).get('/missing');

  assert.equal(response.status, 404);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(response.body, { error: 'Not Found' });
});

test('unexpected errors return a safe JSON 500 response and are logged', async () => {
  const records: Array<Record<string, unknown>> = [];
  const app = createApp({
    logger: createCapturingLogger(records),
    registerRoutes(configuredApp) {
      configuredApp.get('/test-error', () => {
        throw new Error('private failure details');
      });
    },
  });

  const response = await request(app).get('/test-error');

  assert.equal(response.status, 500);
  assert.match(response.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(response.body, { error: 'Internal Server Error' });
  assert.equal(response.text.includes('private failure details'), false);

  const errorRecord = records.find((record) => record.msg === 'Unhandled request error');
  assert.ok(errorRecord);
  assert.equal(errorRecord.requestId, response.headers['x-request-id']);
  assert.match(JSON.stringify(errorRecord.err), /private failure details/);
});

test('configured CORS origins are allowed and unconfigured origins are not reflected', async () => {
  const app = createTestApp({
    config: loadConfig({ CORS_ORIGINS: 'https://allowed.example' }),
  });

  const allowedResponse = await request(app)
    .get('/health')
    .set('Origin', 'https://allowed.example');
  const deniedResponse = await request(app).get('/health').set('Origin', 'https://denied.example');

  assert.equal(allowedResponse.headers['access-control-allow-origin'], 'https://allowed.example');
  assert.equal(deniedResponse.headers['access-control-allow-origin'], undefined);
  assert.equal(deniedResponse.status, 200);
});

test('malformed JSON returns a safe 400 response', async () => {
  const response = await request(createTestApp())
    .post('/api/v1/example')
    .set('Content-Type', 'application/json')
    .send('{"incomplete":');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Invalid JSON' });
  assert.equal(response.text.includes('Unexpected end'), false);
});

test('JSON bodies larger than 100 KB return a safe 413 response', async () => {
  const response = await request(createTestApp())
    .post('/api/v1/example')
    .send({ data: 'x'.repeat(101 * 1024) });

  assert.equal(response.status, 413);
  assert.deepEqual(response.body, { error: 'Payload Too Large' });
});

test('requests include a valid request ID and structured request log fields', async () => {
  const records: Array<Record<string, unknown>> = [];
  const app = createApp({
    logger: createCapturingLogger(records),
    registerRoutes(configuredApp) {
      configuredApp.get('/api/v1/logging', (_request, response) => {
        response.cookie('session', 'response-secret').json({ ok: true });
      });
    },
  });
  const response = await request(app)
    .get('/api/v1/logging')
    .set('X-Request-Id', 'test-request-123')
    .set('Authorization', 'Bearer secret-token')
    .set('Cookie', 'session=secret-cookie')
    .set('X-API-Key', 'secret-api-key');

  assert.equal(response.headers['x-request-id'], 'test-request-123');
  assert.match(response.headers['set-cookie']?.[0] ?? '', /response-secret/);

  const requestRecord = records.find((record) => record.msg === 'request completed');
  assert.ok(requestRecord);
  assert.equal(requestRecord.requestId, 'test-request-123');
  assert.equal(typeof requestRecord.responseTime, 'number');
  assert.doesNotMatch(
    JSON.stringify(requestRecord),
    /secret-token|secret-cookie|secret-api-key|response-secret/,
  );

  const loggedRequest = requestRecord.req as Record<string, unknown>;
  const loggedResponse = requestRecord.res as Record<string, unknown>;
  assert.equal(loggedRequest.method, 'GET');
  assert.equal(loggedRequest.url, '/api/v1/logging');
  assert.equal(loggedResponse.statusCode, 200);
});

test('invalid request IDs are replaced with generated IDs', async () => {
  const response = await request(createTestApp()).get('/health').set('X-Request-Id', 'invalid id');

  assert.match(response.headers['x-request-id'] ?? '', /^[0-9a-f-]{36}$/);
  assert.notEqual(response.headers['x-request-id'], 'invalid id');
});

test('business routes can use /api/v1 while /health remains top-level', async () => {
  const app = createTestApp({
    registerRoutes(configuredApp) {
      configuredApp.get('/api/v1/example', (_request, response) => {
        response.status(200).json({ ok: true });
      });
    },
  });

  const businessResponse = await request(app).get('/api/v1/example');
  const healthResponse = await request(app).get('/health');

  assert.equal(businessResponse.status, 200);
  assert.deepEqual(businessResponse.body, { ok: true });
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(healthResponse.body, { status: 'ok' });
});
