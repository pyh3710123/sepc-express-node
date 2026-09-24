import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  'home content, SMS registration and the first authenticated reads use PostgreSQL',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DEV_SMS_CODE ??= '123456';
    const app = await createApiApp();
    const db = app.get(Database);
    const mobile = `1${randomInt(1_000_000_000, 10_000_000_000)}`;
    const bannerIds: number[] = [];
    try {
      /** 发送 HTTP 测试请求并统一返回状态码和 JSON 响应体。 */
      const request = async (
        method: 'GET' | 'POST',
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

      assert.equal((await request('GET', '/api/home/init')).status, 401);
      const title = `Test banner ${randomUUID()}`;
      for (const [suffix, published, startsAt] of [
        ['live', true, 'now()'],
        ['draft', false, 'now()'],
        ['future', true, "now()+interval '1 day'"],
      ] as const) {
        const inserted = await db.query<{ id: number }>(
          `INSERT INTO home_carousels(title,image_url,link_url,sort_order,published,starts_at)
           VALUES ($1,$2,$3,$4,$5,${startsAt}) RETURNING id`,
          [`${title} ${suffix}`, 'https://example.com/banner.png', '/drama', -1000, published],
        );
        bannerIds.push(inserted.rows[0].id);
      }
      const carousel = await request('GET', '/api/home/carousel');
      assert.equal(carousel.status, 200);
      assert.deepEqual(
        carousel.body.data.list.filter((item: { id: number }) => bannerIds.includes(item.id)),
        [
          {
            id: bannerIds[0],
            title: `${title} live`,
            image_url: 'https://example.com/banner.png',
            link_url: '/drama',
          },
        ],
      );
      assert.ok(carousel.body.data.total >= 1);

      const [sent, rateLimited] = await Promise.all([
        request('POST', '/api/sms/send', undefined, { mobile, sendType: 'login_register' }),
        request('POST', '/api/sms/send', undefined, { mobile, sendType: 'login_register' }),
      ]);
      assert.deepEqual([sent.status, rateLimited.status].sort(), [200, 429]);
      const invalid = await request('POST', '/api/login/sms', undefined, {
        mobile,
        captcha: process.env.DEV_SMS_CODE === '000000' ? '111111' : '000000',
      });
      assert.equal(invalid.status, 401);
      assert.equal((await db.query('SELECT 1 FROM users WHERE mobile=$1', [mobile])).rowCount, 0);
      const registered = await request('POST', '/api/login/sms', undefined, {
        mobile,
        captcha: process.env.DEV_SMS_CODE,
      });
      assert.equal(registered.status, 200);
      const token = registered.body.data.access_token as string;
      assert.ok(token);
      assert.ok(registered.body.data.refresh_token);
      assert.equal(
        (
          await request('POST', '/api/login/sms', undefined, {
            mobile,
            captcha: process.env.DEV_SMS_CODE,
          })
        ).status,
        401,
      );
      const [info, credit, init] = await Promise.all([
        request('GET', '/api/user/info', token),
        request('GET', '/api/credit', token),
        request('GET', '/api/home/init', token),
      ]);
      assert.equal(info.status, 200);
      assert.equal(info.body.data.account_type, 'personal');
      assert.equal(info.body.data.role_name, 'owner');
      assert.ok(info.body.data.account_id > 0);
      assert.equal(credit.body.data.total_balance, 0);
      assert.equal(init.status, 200);
      assert.equal(init.body.data.model_enabled, true);

      await db.query(
        "UPDATE sms_challenges SET created_at=now()-interval '2 minutes' WHERE mobile=$1",
        [mobile],
      );
      assert.equal(
        (
          await request('POST', '/api/sms/send', undefined, {
            mobile,
            sendType: 'login_register',
          })
        ).status,
        200,
      );
      const repeatLogin = await request('POST', '/api/login/sms', undefined, {
        mobile,
        captcha: process.env.DEV_SMS_CODE,
      });
      assert.equal(repeatLogin.status, 200);
      const repeatInfo = await request('GET', '/api/user/info', repeatLogin.body.data.access_token);
      assert.equal(repeatInfo.body.data.account_id, info.body.data.account_id);

      await db.query(
        `UPDATE sms_challenges SET created_at=now()-interval '2 minutes' WHERE mobile=$1`,
        [mobile],
      );
      await db.query(
        `INSERT INTO sms_challenges(mobile,send_type,code_hash,expires_at,created_at)
         SELECT $1,'login_register',repeat('0',64),now()-interval '1 minute',now()-interval '2 minutes'
         FROM generate_series(1,8)`,
        [mobile],
      );
      assert.equal(
        (
          await request('POST', '/api/sms/send', undefined, {
            mobile,
            sendType: 'login_register',
          })
        ).status,
        429,
      );
    } finally {
      try {
        await db.query('DELETE FROM home_carousels WHERE id=ANY($1::int[])', [bannerIds]);
        const account = await db.query<{ id: number }>('SELECT id FROM users WHERE mobile=$1', [
          mobile,
        ]);
        if (account.rows[0]) {
          await db.query("DELETE FROM accounts WHERE owner_user_id=$1 AND type='personal'", [
            account.rows[0].id,
          ]);
          await db.query('DELETE FROM users WHERE id=$1', [account.rows[0].id]);
        }
        await db.query('DELETE FROM sms_challenges WHERE mobile=$1', [mobile]);
      } finally {
        await app.close();
      }
    }
  },
);
