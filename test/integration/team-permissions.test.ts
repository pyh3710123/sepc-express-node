import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';
import { APP_CONFIG, type AppConfig } from '../../src/config';

test(
  'team permission overrides, transaction rollback and member removal revoke old sessions',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    const config = app.get<AppConfig>(APP_CONFIG);
    const subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    let teamId: number | undefined;
    try {
      const request = async (
        method: 'GET' | 'POST' | 'PUT',
        url: string,
        token?: string,
        payload?: Record<string, unknown>,
      ) => {
        const response = await app.inject({
          method,
          url,
          headers: token ? { authorization: `Bearer ${token}` } : {},
          payload,
        });
        return { status: response.statusCode, body: response.json() };
      };
      const aliceLogin = await request('POST', '/api/login/password', undefined, {
        username: 'demo_alice',
        password: 'Local-demo-123!',
      });
      const bobLogin = await request('POST', '/api/login/password', undefined, {
        username: 'demo_bob',
        password: 'Local-demo-123!',
      });
      assert.equal(aliceLogin.status, 200);
      assert.equal(bobLogin.status, 200);
      const alicePersonal = aliceLogin.body.data.access_token as string;
      const bobPersonal = bobLogin.body.data.access_token as string;
      const createdTeam = await request('POST', '/api/account', alicePersonal, {
        name: `Permission ${randomUUID()}`,
        intro: '权限集成测试',
      });
      assert.equal(createdTeam.status, 200);
      teamId = createdTeam.body.data.account_id as number;
      const bobUser = await db.query<{ id: number }>(
        "SELECT id FROM users WHERE username='demo_bob'",
      );
      const bobUserId = bobUser.rows[0].id;
      await db.query(
        `INSERT INTO account_members(account_id,user_id,role) VALUES ($1,$2,'member')`,
        [teamId, bobUserId],
      );
      const aliceSwitch = await request('POST', '/api/account/change', alicePersonal, {
        account_id: teamId,
      });
      const bobSwitch = await request('POST', '/api/account/change', bobPersonal, {
        account_id: teamId,
      });
      assert.equal(aliceSwitch.status, 200);
      assert.equal(bobSwitch.status, 200);
      const alice = aliceSwitch.body.data.access_token as string;
      const bob = bobSwitch.body.data.access_token as string;
      const bobOutsideLogin = await request('POST', '/api/login/password', undefined, {
        username: 'demo_bob',
        password: 'Local-demo-123!',
      });
      const bobOutside = bobOutsideLogin.body.data.access_token as string;
      const createdDrama = await request('POST', '/api/drama', bob, {
        parent_id: 0,
        is_group: false,
        title: '默认可创建',
      });
      assert.equal(createdDrama.status, 200);
      const dramaId = createdDrama.body.data.drama_id as number;
      const canvasId = createdDrama.body.data.canvas_id as number;
      assert.ok(canvasId > 0);
      const body = (permission_code: string) => ({
        can_create: true,
        assets_share: false,
        project_type: 'drama',
        project_id: dramaId,
        list: [{ user_id: bobUserId, permission_code }],
      });
      assert.equal(
        (await request('POST', '/api/data/permission/project', alice, body('viewer'))).status,
        200,
      );
      assert.equal((await request('GET', `/api/drama/canvas/${canvasId}`, bob)).status, 200);
      assert.equal(
        (await request('PUT', '/api/drama', bob, { drama_id: dramaId, title: '禁止编辑' })).status,
        403,
      );
      assert.equal(
        (
          await request('POST', '/api/drama/canvas', bob, {
            drama_id: dramaId,
            title: '禁止创建画布',
          })
        ).status,
        403,
      );
      assert.equal(
        (await request('POST', '/api/data/permission/project', bob, body('editor'))).status,
        403,
      );
      assert.equal(
        (await request('POST', '/api/data/permission/project', alice, body('none'))).status,
        200,
      );
      assert.equal((await request('GET', `/api/drama/canvas/${canvasId}`, bob)).status, 404);
      const hidden = await request('GET', '/api/drama', bob);
      assert.equal(hidden.status, 200);
      assert.equal(
        hidden.body.data.list.some((item: { drama_id: number }) => item.drama_id === dramaId),
        false,
      );
      assert.equal(
        (await request('POST', '/api/data/permission/project', alice, body('editor'))).status,
        200,
      );
      assert.equal(
        (await request('PUT', '/api/drama', bob, { drama_id: dramaId, title: '恢复编辑' })).status,
        200,
      );
      assert.equal(
        (
          await request('POST', '/api/data/permission', alice, {
            can_create: false,
            assets_share: false,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request('POST', '/api/drama', bob, {
            parent_id: 0,
            is_group: false,
            title: '被禁止创建',
          })
        ).status,
        403,
      );
      const invalid = await request('POST', '/api/data/permission/project', alice, {
        can_create: true,
        assets_share: true,
        project_type: 'drama',
        project_id: dramaId,
        list: [{ user_id: 2147483647, permission_code: 'none' }],
      });
      assert.equal(invalid.status, 400);
      const global = await request('GET', '/api/data/permission', alice);
      assert.deepEqual(global.body.data, { can_create: false, assets_share: false });
      await subscriber.subscribe('session-invalidations');
      const sessionId = (jwt.decode(bob) as { sid: string }).sid;
      const invalidated = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('未收到跨实例会话撤销消息')), 3000);
        subscriber.on('message', (_channel, value) => {
          if (value === sessionId) {
            clearTimeout(timeout);
            resolve(value);
          }
        });
      });
      assert.equal(
        (await request('POST', '/api/account/remove', alice, { target_uid: bobUserId })).status,
        200,
      );
      assert.equal(await invalidated, sessionId);
      assert.equal((await request('GET', '/api/user/info', bob)).status, 401);
      assert.equal(
        (await request('POST', '/api/account/change', bobOutside, { account_id: teamId })).status,
        404,
      );
    } finally {
      subscriber.disconnect();
      if (teamId) {
        await db.query('DELETE FROM dramas WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [teamId]);
      }
      await app.close();
    }
  },
);
