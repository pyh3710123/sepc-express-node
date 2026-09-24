import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { batchSchema } from '../src/features/canvas/canvas.schemas';
import { loadConfig } from '../src/config';
import { semanticHash } from '../src/features/generation/generation.service';
import { createApiApp } from '../src/main';

let app: NestFastifyApplication;
before(async () => {
  app = await createApiApp();
});
after(async () => {
  await app.close();
});

test('health, API errors and security headers use the documented paths', async () => {
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.ok(health.headers['x-request-id']);
  const unauthorized = await app.inject({ method: 'GET', url: '/api/user/info' });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.json().code, 401);
  const homeUnauthorized = await app.inject({ method: 'GET', url: '/api/home/init' });
  assert.equal(homeUnauthorized.statusCode, 401);
  const unavailable = await app.inject({
    method: 'POST',
    url: '/api/login/wechat',
    payload: { code: 'example' },
  });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().code, 503);
  const invalidWechat = await app.inject({
    method: 'POST',
    url: '/api/login/wechat',
    payload: {},
  });
  assert.equal(invalidWechat.statusCode, 400);
  const invalid = await app.inject({ method: 'POST', url: '/api/login/password', payload: {} });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().code, 400);
});

test('feature controllers remain registered after directory split', async () => {
  const routes: { method: 'GET' | 'POST'; url: string }[] = [
    { method: 'GET', url: '/api/account' },
    { method: 'GET', url: '/api/credit' },
    { method: 'GET', url: '/api/drama' },
    { method: 'GET', url: '/api/drama/subset' },
    { method: 'POST', url: '/api/drama/merge' },
    { method: 'GET', url: '/api/drama/canvas/1' },
    { method: 'POST', url: '/api/node/batch' },
    { method: 'POST', url: '/api/task/generation/create' },
    { method: 'POST', url: '/api/team/join' },
    { method: 'GET', url: '/api/oss/sts' },
  ];
  for (const route of routes) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 401, `${route.method} ${route.url}`);
  }
});

test('malformed or oversized JSON receives a safe business error', async () => {
  const malformed = await app.inject({
    method: 'POST',
    url: '/api/login/password',
    headers: { 'content-type': 'application/json' },
    payload: '{broken',
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, 400);
  const oversized = await app.inject({
    method: 'POST',
    url: '/api/login/password',
    payload: { username: 'x'.repeat(1024 * 1024), password: 'x' },
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().code, 413);
  assert.equal(oversized.body.includes('x'.repeat(100)), false);
});

test('OpenAPI is served from /openapi.json and uses /api paths', async () => {
  const response = await app.inject({ method: 'GET', url: '/openapi.json' });
  assert.equal(response.statusCode, 200);
  const document = response.json();
  assert.equal(document.openapi, '3.1.0');
  assert.ok(document.paths['/api/node/batch'].post);
  assert.ok(document.paths['/api/task/generation/create'].post);
  assert.ok(document.paths['/api/home/carousel'].get);
  assert.deepEqual(document.paths['/api/home/carousel'].get.security, []);
  assert.equal(document.paths['/api/workflow/save'], undefined);
});

test('configuration rejects unsafe production modes and invalid origins', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /Production requires/);
  assert.throws(
    () => loadConfig({ ALLOWED_WEB_ORIGINS: 'https://example.com/path' }),
    /Invalid origin/,
  );
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        REFRESH_TOKEN_SECRET: 'b'.repeat(32),
        DEV_MOCK_EXTERNALS: 'true',
      }),
    /forbidden/,
  );
});

test('semantic hashes ignore object key order and retain task array order', () => {
  assert.equal(
    semanticHash({ a: 1, b: { x: 2, y: 3 } }),
    semanticHash({ b: { y: 3, x: 2 }, a: 1 }),
  );
  assert.notEqual(semanticHash([{ a: 1 }, { a: 2 }]), semanticHash([{ a: 2 }, { a: 1 }]));
});

test('batch schema rejects client database IDs on create and accepts parent_uuid null', () => {
  const valid = {
    drama_id: 1,
    canvas_id: 1,
    expected_version: 0,
    nodes: {
      create: [
        {
          uuid: 'node-a',
          type: 'text',
          node_name: '正文',
          position: { x: 1, y: 2 },
          parent_uuid: null,
        },
      ],
    },
  };
  assert.equal(batchSchema.safeParse(valid).success, true);
  assert.equal(
    batchSchema.safeParse({ ...valid, nodes: { create: [{ ...valid.nodes.create[0], id: 10 }] } })
      .success,
    false,
  );
});
