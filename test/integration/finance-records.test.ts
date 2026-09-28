import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  '订单、发票按账号隔离，外部支付与开票拒绝伪造成功',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    const orderNos: string[] = [];
    const invoiceIds: number[] = [];
    try {
      const request = async (
        method: 'GET' | 'POST' | 'DELETE',
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
      const login = async (username: string): Promise<string> => {
        const result = await request('POST', '/api/login/password', undefined, {
          username,
          password: 'Local-demo-123!',
        });
        assert.equal(result.status, 200);
        return result.body.data.access_token as string;
      };
      const alice = await login('demo_alice');
      const bob = await login('demo_bob');
      const aliceAccount = (await request('GET', '/api/user/info', alice)).body.data
        .account_id as number;
      const bobAccount = (await request('GET', '/api/user/info', bob)).body.data
        .account_id as number;
      const insertOrder = async (
        accountId: number,
        type: string,
        status: number,
        subject: string,
      ): Promise<{ id: number; orderNo: string }> => {
        const orderNo = `finance-${randomUUID()}`;
        const inserted = await db.query<{ id: number }>(
          `INSERT INTO orders(order_no,account_id,order_type,amount_cents,pay_status,expires_at,subject,paid_at,pay_cycle,channel,metadata)
           VALUES ($1,$2,$3,1200,$4,now()+interval '1 day',$5,
             CASE WHEN $4 IN (2,3) THEN now() ELSE NULL END,'monthly','alipay',$6)
           RETURNING id`,
          [orderNo, accountId, type, status, subject, { capacity_gb: 10 }],
        );
        orderNos.push(orderNo);
        return { id: inserted.rows[0].id, orderNo };
      };
      const subscription = await insertOrder(aliceAccount, 'subscribe', 2, '测试会员');
      const capacity = await insertOrder(aliceAccount, 'capacity', 3, '测试空间');
      const pending = await insertOrder(aliceAccount, 'seat_expand', 1, '测试席位');
      const foreign = await insertOrder(bobAccount, 'subscribe', 2, '其他账号会员');

      const info = await request('GET', `/api/order/info?order_no=${subscription.orderNo}`, alice);
      assert.equal(info.status, 200);
      assert.equal(info.body.data.payStatus, 2);
      assert.equal(info.body.data.payAmount, 12);
      assert.equal(typeof info.body.data.expireTimeTs, 'number');
      assert.equal(
        (await request('GET', `/api/order/info?order_no=${foreign.orderNo}`, alice)).status,
        404,
      );
      const records = await request('GET', '/api/order/record?page=1&limit=20', alice);
      assert.equal(records.status, 200);
      assert.ok(
        records.body.data.list.some(
          (row: { order_no: string }) => row.order_no === subscription.orderNo,
        ),
      );
      assert.ok(
        !records.body.data.list.some(
          (row: { order_no: string }) => row.order_no === foreign.orderNo,
        ),
      );
      const subscriptions = await request('GET', '/api/order/subscribe?page=1&limit=20', alice);
      assert.equal(subscriptions.status, 200);
      assert.ok(
        subscriptions.body.data.list.some(
          (row: { plan_title: string }) => row.plan_title === '测试会员',
        ),
      );
      const bills = await request('GET', '/api/space/bill?page=1&limit=20', alice);
      assert.equal(bills.status, 200);
      assert.ok(
        bills.body.data.list.some((row: { record_id: number }) => row.record_id === capacity.id),
      );

      assert.equal(
        (
          await request('POST', '/api/order/create', alice, {
            order_type: 'seat_expand',
            buy_num: 2,
          })
        ).status,
        503,
      );
      assert.equal(
        (
          await request('POST', '/api/order/create', alice, {
            order_type: 'seat_expand',
            buy_num: 0,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('POST', '/api/order/update', alice, {
            order_no: pending.orderNo,
            buy_num: 2,
          })
        ).status,
        503,
      );
      assert.equal(
        (
          await request('POST', '/api/order/update', alice, {
            order_no: subscription.orderNo,
            buy_num: 2,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request('POST', '/api/order/update', alice, {
            order_no: foreign.orderNo,
            buy_num: 2,
          })
        ).status,
        404,
      );
      const invoiceBody = {
        invoice_type: 'personal',
        invoice_kind: 'common',
        title: '测试抬头',
        email: 'finance@example.test',
        order_ids: [subscription.id],
      };
      assert.equal((await request('POST', '/api/invoice/create', alice, invoiceBody)).status, 503);
      assert.equal(
        (
          await request('POST', '/api/invoice/create', alice, {
            ...invoiceBody,
            order_ids: [foreign.id],
          })
        ).status,
        404,
      );
      const invoice = await db.query<{ id: number }>(
        `INSERT INTO invoices(account_id,status,invoice_type,invoice_kind,title,email)
         VALUES ($1,'processing','personal','common','测试抬头','finance@example.test') RETURNING id`,
        [aliceAccount],
      );
      const invoiceId = invoice.rows[0].id;
      invoiceIds.push(invoiceId);
      await db.query('INSERT INTO invoice_orders(invoice_id,order_no) VALUES ($1,$2)', [
        invoiceId,
        subscription.orderNo,
      ]);
      assert.equal(
        (await request('GET', `/api/invoice/file?invoice_id=${invoiceId}`, alice)).status,
        409,
      );
      assert.equal((await request('DELETE', `/api/invoice/${invoiceId}`, bob)).status, 404);
      assert.equal((await request('DELETE', `/api/invoice/${invoiceId}`, alice)).status, 200);
      assert.equal((await request('DELETE', `/api/invoice/${invoiceId}`, alice)).status, 200);
      assert.equal(
        (await db.query('SELECT 1 FROM invoice_orders WHERE invoice_id=$1', [invoiceId])).rowCount,
        0,
      );
      assert.equal((await request('POST', '/api/invoice/create', alice, invoiceBody)).status, 503);
    } finally {
      if (invoiceIds.length)
        await db.query('DELETE FROM invoices WHERE id=ANY($1::int[])', [invoiceIds]);
      if (orderNos.length)
        await db.query('DELETE FROM orders WHERE order_no=ANY($1::text[])', [orderNos]);
      await app.close();
    }
  },
);
