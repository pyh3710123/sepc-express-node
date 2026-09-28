import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import {
  ProjectsService,
  RECYCLE_PURGE_BATCH_SIZE,
} from '../../src/features/projects/projects.service';
import { createApiApp } from '../../src/main';

test(
  'expired recycle cleanup respects child retention and running tasks while preserving audit history',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    const projects = app.get(ProjectsService);
    const createdIds: number[] = [];
    const requestId = randomUUID();
    const taskId = randomUUID();
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/login/password',
        payload: { username: 'demo_alice', password: 'Local-demo-123!' },
      });
      assert.equal(login.statusCode, 200);
      const token = login.json().data.access_token as string;

      /** 使用真实项目接口创建并软删除测试项目。 */
      async function createDrama(
        parentId: number,
        isGroup: boolean,
      ): Promise<{
        dramaId: number;
        canvasId?: number;
      }> {
        const response = await app.inject({
          method: 'POST',
          url: '/api/drama',
          headers: { authorization: `Bearer ${token}` },
          payload: { parent_id: parentId, is_group: isGroup, title: `Retention ${randomUUID()}` },
        });
        assert.equal(response.statusCode, 200);
        const dramaId = response.json().data.drama_id as number;
        const canvasId = response.json().data.canvas_id as number | undefined;
        createdIds.push(dramaId);
        return { dramaId, canvasId };
      }

      const expiredGroup = await createDrama(0, true);
      const expiredChild = await createDrama(expiredGroup.dramaId, false);
      const mixedGroup = await createDrama(0, true);
      const recentChild = await createDrama(mixedGroup.dramaId, false);
      const runningDrama = await createDrama(0, false);
      const recentDrama = await createDrama(0, false);
      assert.ok(runningDrama.canvasId);
      const deleted = await app.inject({
        method: 'DELETE',
        url: '/api/drama',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          ids: [
            expiredGroup.dramaId,
            mixedGroup.dramaId,
            runningDrama.dramaId,
            recentDrama.dramaId,
          ],
        },
      });
      assert.equal(deleted.statusCode, 200);
      await db.query(
        `UPDATE dramas SET deleted_at=now() - interval '31 days'
         WHERE id=ANY($1::int[])`,
        [[expiredGroup.dramaId, expiredChild.dramaId, mixedGroup.dramaId, runningDrama.dramaId]],
      );
      await db.query(
        `UPDATE dramas SET deleted_at=now() - interval '29 days'
         WHERE id=ANY($1::int[])`,
        [[recentChild.dramaId, recentDrama.dramaId]],
      );
      const account = await db.query<{ account_id: number }>(
        'SELECT account_id FROM dramas WHERE id=$1',
        [runningDrama.dramaId],
      );
      const accountId = account.rows[0].account_id;
      await db.query(
        `INSERT INTO generation_requests(id,account_id,endpoint,request_id,payload_hash,status)
         VALUES ($1,$2,'test/recycle-retention',$3,'test','accepted')`,
        [requestId, accountId, requestId],
      );
      await db.query(
        `INSERT INTO generation_tasks(task_id,generation_request_id,task_index,account_id,canvas_id,status,price_credits,payload)
         VALUES ($1,$2,0,$3,$4,'running',0,'{}'::jsonb)`,
        [taskId, requestId, accountId, runningDrama.canvasId],
      );

      assert.equal(await projects.purgeExpiredRecycledDramas(), 2);
      const firstPass = await db.query<{ id: number }>(
        'SELECT id FROM dramas WHERE id=ANY($1::int[]) ORDER BY id',
        [createdIds],
      );
      assert.deepEqual(
        firstPass.rows.map((row) => row.id),
        [mixedGroup.dramaId, recentChild.dramaId, runningDrama.dramaId, recentDrama.dramaId].sort(
          (left, right) => left - right,
        ),
      );

      await db.query("UPDATE generation_tasks SET status='completed' WHERE task_id=$1", [taskId]);
      await db.query("UPDATE dramas SET deleted_at=now() - interval '31 days' WHERE id=$1", [
        recentChild.dramaId,
      ]);
      assert.equal(await projects.purgeExpiredRecycledDramas(), 3);
      const secondPass = await db.query<{ id: number }>(
        'SELECT id FROM dramas WHERE id=ANY($1::int[]) ORDER BY id',
        [createdIds],
      );
      assert.deepEqual(
        secondPass.rows.map((row) => row.id),
        [recentDrama.dramaId],
      );
      const retainedTask = await db.query<{ canvas_id: number | null }>(
        'SELECT canvas_id FROM generation_tasks WHERE task_id=$1',
        [taskId],
      );
      assert.deepEqual(retainedTask.rows[0], { canvas_id: null });
      assert.equal(await projects.purgeExpiredRecycledDramas(), 0);
    } finally {
      try {
        await db.query('DELETE FROM generation_tasks WHERE task_id=$1', [taskId]);
        await db.query('DELETE FROM generation_requests WHERE id=$1', [requestId]);
        await db.query('UPDATE dramas SET parent_id=NULL WHERE id=ANY($1::int[])', [createdIds]);
        await db.query('DELETE FROM dramas WHERE id=ANY($1::int[])', [createdIds]);
      } finally {
        await app.close();
      }
    }
  },
);

test(
  'recycle cleanup scans past a full page of blocked projects without repeating its timestamp cursor',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    const createdIds: number[] = [];
    try {
      const owner = await db.query<{ id: number; account_id: number }>(
        `SELECT u.id,a.id AS account_id FROM users u JOIN accounts a ON a.owner_user_id=u.id
         WHERE u.username='demo_alice' AND a.type='personal'`,
      );
      const { id: userId, account_id: accountId } = owner.rows[0];
      const groups = await db.query<{ id: number }>(
        `INSERT INTO dramas(account_id,created_by,title,type,deleted_at)
         SELECT $1,$2,'Blocked cleanup group ' || counter.value,'group',now() - interval '31 days'
         FROM generate_series(1,$3::int) AS counter(value) RETURNING id`,
        [accountId, userId, RECYCLE_PURGE_BATCH_SIZE],
      );
      const groupIds = groups.rows.map((row) => row.id);
      createdIds.push(...groupIds);
      const children = await db.query<{ id: number }>(
        `INSERT INTO dramas(account_id,created_by,title,type,parent_id,deleted_at)
         SELECT $2,$3,'Recent cleanup child ' || parent.id,'drama',parent.id,
                now() - interval '29 days'
         FROM unnest($1::int[]) AS parent(id) RETURNING id`,
        [groupIds, accountId, userId],
      );
      createdIds.push(...children.rows.map((row) => row.id));
      const eligible = await db.query<{ id: number }>(
        `INSERT INTO dramas(account_id,created_by,title,type,deleted_at)
         VALUES ($1,$2,'Eligible after blocked page','drama',now() - interval '31 days')
         RETURNING id`,
        [accountId, userId],
      );
      const eligibleId = eligible.rows[0].id;
      createdIds.push(eligibleId);

      assert.equal(await app.get(ProjectsService).purgeExpiredRecycledDramas(), 1);
      const remaining = await db.query<{ id: number }>(
        'SELECT id FROM dramas WHERE id=ANY($1::int[])',
        [[eligibleId]],
      );
      assert.equal(remaining.rowCount, 0);
    } finally {
      try {
        await db.query('UPDATE dramas SET parent_id=NULL WHERE id=ANY($1::int[])', [createdIds]);
        await db.query('DELETE FROM dramas WHERE id=ANY($1::int[])', [createdIds]);
      } finally {
        await app.close();
      }
    }
  },
);
