import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  'project recycle isolates accounts, protects members and retains task history after purge',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    const requestId = randomUUID();
    const taskId = randomUUID();
    let dramaId: number | undefined;
    try {
      /** 发送业务请求并返回状态码和统一响应体。 */
      const request = async (
        method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
      const accounts = await request('GET', '/api/account', alicePersonal);
      const teamId = accounts.body.data.list.find(
        (row: { account_type: string }) => row.account_type === 'team',
      ).account_id as number;
      const aliceSwitch = await request('POST', '/api/account/change', alicePersonal, {
        account_id: teamId,
      });
      const bobSwitch = await request('POST', '/api/account/change', bobPersonal, {
        account_id: teamId,
      });
      assert.equal(aliceSwitch.status, 200);
      assert.equal(bobSwitch.status, 200);
      const alice = aliceSwitch.body.data.access_token as string;
      const bobMember = bobSwitch.body.data.access_token as string;
      const bobOutsideLogin = await request('POST', '/api/login/password', undefined, {
        username: 'demo_bob',
        password: 'Local-demo-123!',
      });
      assert.equal(bobOutsideLogin.status, 200);
      const bobOutside = bobOutsideLogin.body.data.access_token as string;
      const title = `Recycle ${randomUUID()}`;
      const created = await request('POST', '/api/drama', alice, {
        parent_id: 0,
        is_group: false,
        title,
      });
      assert.equal(created.status, 200);
      dramaId = created.body.data.drama_id as number;
      const canvasId = created.body.data.canvas_id as number;
      assert.ok(canvasId > 0);
      const listed = await request('GET', '/api/drama?parent_id=0&all=2', alice);
      assert.equal(listed.status, 200);
      assert.ok(listed.body.data.drama_total >= 1);
      assert.equal(
        listed.body.data.list.find((item: { drama_id: number }) => item.drama_id === dramaId)
          .canvas_id,
        canvasId,
      );
      const node = await request('POST', '/api/node/batch', alice, {
        drama_id: dramaId,
        canvas_id: canvasId,
        expected_version: 0,
        nodes: {
          create: [
            {
              uuid: `node-${randomUUID()}`,
              type: 'text',
              node_name: '正文',
              position: { x: 0, y: 0 },
              content: '保留审计记录',
            },
          ],
        },
      });
      assert.equal(node.status, 200);
      const nodeId = node.body.data.nodes.create[0].node_id as number;

      const renamed = await request('PUT', '/api/drama', bobMember, {
        drama_id: dramaId,
        title: `${title} updated`,
      });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.data.title, `${title} updated`);
      const covered = await request('PUT', '/api/drama', alice, {
        drama_id: dramaId,
        cover_image: 'mock://demo/team/sample.png',
      });
      assert.equal(covered.status, 200);
      assert.equal(covered.body.data.cover_image, 'mock://demo/team/sample.png');
      const detailWithCover = await request('GET', `/api/drama/canvas/${canvasId}`, alice);
      assert.equal(detailWithCover.body.data.drama_title, `${title} updated`);
      assert.equal(detailWithCover.body.data.cover_image, 'mock://demo/team/sample.png');
      assert.ok(detailWithCover.body.data.canvas_options.length >= 1);
      assert.equal(
        (
          await request('PUT', '/api/drama', alice, {
            drama_id: dramaId,
            cover_image: 'https://example.com/unregistered.png',
          })
        ).status,
        404,
      );
      assert.equal(
        (await request('PUT', '/api/drama', bobOutside, { drama_id: dramaId, title: 'x' })).status,
        404,
      );
      assert.equal(
        (await request('DELETE', '/api/drama', bobMember, { ids: [dramaId] })).status,
        403,
      );
      assert.equal((await request('DELETE', '/api/drama', alice, { ids: [dramaId] })).status, 200);
      assert.equal((await request('GET', `/api/drama/canvas/${canvasId}`, alice)).status, 404);
      assert.equal(
        (
          await request('POST', '/api/drama/canvas', alice, {
            drama_id: dramaId,
            title: 'Hidden Canvas',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request('POST', '/api/task/generation/create', alice, {
            request_id: randomUUID(),
            drama_id: dramaId,
            canvas_id: canvasId,
            node_id: nodeId,
            node_type: 'image',
            task_type: 'image',
            model_code: 'mock-image',
            mode_type: 'text2image',
            inputs: { prompt: 'cat' },
          })
        ).status,
        404,
      );
      assert.equal(
        (await request('GET', '/api/drama', alice)).body.data.list.some(
          (item: { drama_id: number }) => item.drama_id === dramaId,
        ),
        false,
      );
      const recycle = await request(
        'GET',
        `/api/project/recycle?page=1&limit=100&name=${encodeURIComponent(title)}&type=drama`,
        alice,
      );
      assert.equal(recycle.status, 200);
      assert.ok(
        recycle.body.data.list.some(
          (item: { id: number; project_name: string }) =>
            item.id === dramaId && item.project_name === `${title} updated`,
        ),
      );
      assert.equal(
        (await request('GET', '/api/project/recycle', bobOutside)).body.data.list.some(
          (item: { drama_id: number }) => item.drama_id === dramaId,
        ),
        false,
      );
      assert.equal(
        (
          await request('POST', '/api/project/recycle/restore', bobOutside, {
            ids: [dramaId],
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request('POST', '/api/project/recycle/restore', bobMember, {
            ids: [dramaId],
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request('POST', '/api/project/recycle/restore', alice, {
            ids: [dramaId],
          })
        ).status,
        200,
      );
      assert.equal((await request('GET', `/api/drama/canvas/${canvasId}`, alice)).status, 200);
      assert.equal((await request('DELETE', '/api/drama', alice, { ids: [dramaId] })).status, 200);

      await db.query(
        `INSERT INTO generation_requests(id,account_id,endpoint,request_id,payload_hash,status)
         VALUES ($1,$2,'test/recycle',$3,'test','accepted')`,
        [requestId, teamId, requestId],
      );
      await db.query(
        `INSERT INTO generation_tasks(task_id,generation_request_id,task_index,account_id,canvas_id,node_id,status,price_credits,payload)
         VALUES ($1,$2,0,$3,$4,$5,'queued',0,'{}'::jsonb)`,
        [taskId, requestId, teamId, canvasId, nodeId],
      );
      const purgeBody = { ids: [dramaId] };
      assert.equal(
        (await request('DELETE', '/api/project/recycle', bobOutside, purgeBody)).status,
        404,
      );
      assert.equal((await request('DELETE', '/api/project/recycle', alice, purgeBody)).status, 409);
      assert.equal(
        (await request('DELETE', '/api/project/recycle', alice, { ids: [dramaId, dramaId] }))
          .status,
        400,
      );
      await db.query("UPDATE generation_tasks SET status='completed' WHERE task_id=$1", [taskId]);
      const purged = await request('DELETE', '/api/project/recycle', alice, purgeBody);
      assert.equal(purged.status, 200);
      assert.deepEqual(purged.body.data.deleted_ids, [dramaId]);
      assert.equal(
        (await request('GET', '/api/project/recycle', alice)).body.data.list.some(
          (item: { drama_id: number }) => item.drama_id === dramaId,
        ),
        false,
      );
      const retained = await db.query<{ canvas_id: number | null; node_id: number | null }>(
        'SELECT canvas_id,node_id FROM generation_tasks WHERE task_id=$1',
        [taskId],
      );
      assert.deepEqual(retained.rows[0], { canvas_id: null, node_id: null });
      assert.equal(
        (
          await request('POST', '/api/project/recycle/restore', alice, {
            ids: [dramaId],
          })
        ).status,
        404,
      );
    } finally {
      try {
        await db.query('DELETE FROM generation_tasks WHERE task_id=$1', [taskId]);
        await db.query('DELETE FROM generation_requests WHERE id=$1', [requestId]);
        if (dramaId) await db.query('DELETE FROM dramas WHERE id=$1', [dramaId]);
      } finally {
        await app.close();
      }
    }
  },
);

test(
  'project groups create, filter, delete, restore and purge their child projects',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    let groupId: number | undefined;
    let childId: number | undefined;
    let siblingId: number | undefined;
    try {
      /** 通过实际 HTTP 协议验证项目组和子项目的生命周期。 */
      const request = async (
        method: 'GET' | 'POST' | 'DELETE',
        url: string,
        token: string,
        payload?: Record<string, unknown>,
      ) => {
        const response = await app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${token}` },
          payload,
        });
        return { status: response.statusCode, body: response.json() };
      };
      const login = await app.inject({
        method: 'POST',
        url: '/api/login/password',
        payload: { username: 'demo_alice', password: 'Local-demo-123!' },
      });
      assert.equal(login.statusCode, 200);
      const alice = login.json().data.access_token as string;
      const group = await request('POST', '/api/drama', alice, {
        parent_id: 0,
        is_group: true,
      });
      assert.equal(group.status, 200);
      groupId = group.body.data.drama_id as number;
      assert.equal(group.body.data.canvas_id, undefined);
      const child = await request('POST', '/api/drama', alice, {
        parent_id: groupId,
        is_group: false,
      });
      assert.equal(child.status, 200);
      childId = child.body.data.drama_id as number;
      const canvasId = child.body.data.canvas_id as number;
      assert.ok(canvasId > 0);
      const sibling = await request('POST', '/api/drama', alice, {
        parent_id: 0,
        is_group: false,
      });
      assert.equal(sibling.status, 200);
      siblingId = sibling.body.data.drama_id as number;
      const root = await request('GET', '/api/drama?parent_id=0&all=1', alice);
      assert.ok(root.body.data.group_total >= 1);
      assert.ok(
        root.body.data.list.some(
          (item: { drama_id: number; is_group: boolean }) =>
            item.drama_id === groupId && item.is_group,
        ),
      );
      const children = await request('GET', `/api/drama?parent_id=${groupId}`, alice);
      assert.equal(children.body.data.list.length, 1);
      assert.equal(children.body.data.list[0].drama_id, childId);
      const deleted = await request('DELETE', '/api/drama', alice, { ids: [groupId, siblingId] });
      assert.equal(deleted.status, 200);
      assert.deepEqual(
        deleted.body.data.deleted_ids,
        [groupId, childId, siblingId].sort((a, b) => a - b),
      );
      assert.equal((await request('GET', `/api/drama/canvas/${canvasId}`, alice)).status, 404);
      const restored = await request('POST', '/api/project/recycle/restore', alice, {
        ids: [groupId, siblingId],
      });
      assert.equal(restored.status, 200);
      assert.deepEqual(
        restored.body.data.restored_ids,
        [groupId, childId, siblingId].sort((a, b) => a - b),
      );
      assert.equal((await request('GET', `/api/drama/canvas/${canvasId}`, alice)).status, 200);
      assert.equal(
        (await request('DELETE', '/api/drama', alice, { ids: [groupId, siblingId] })).status,
        200,
      );
      const purged = await request('DELETE', '/api/project/recycle', alice, {
        ids: [groupId, siblingId],
      });
      assert.equal(purged.status, 200);
      assert.deepEqual(
        purged.body.data.deleted_ids,
        [groupId, childId, siblingId].sort((a, b) => a - b),
      );
    } finally {
      try {
        if (childId) await db.query('DELETE FROM dramas WHERE id=$1', [childId]);
        if (siblingId) await db.query('DELETE FROM dramas WHERE id=$1', [siblingId]);
        if (groupId) await db.query('DELETE FROM dramas WHERE id=$1', [groupId]);
      } finally {
        await app.close();
      }
    }
  },
);

test(
  'project group moves, merge and untie preserve ownership, canvases and recycled children',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    const createdIds: number[] = [];
    try {
      /** 通过 HTTP 校验前端项目组操作的请求字段及事务结果。 */
      const request = async (
        method: 'GET' | 'POST' | 'DELETE',
        url: string,
        token: string,
        payload?: Record<string, unknown>,
      ) => {
        const response = await app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${token}` },
          payload,
        });
        return { status: response.statusCode, body: response.json() };
      };
      const login = async (username: string): Promise<string> => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/login/password',
          payload: { username, password: 'Local-demo-123!' },
        });
        assert.equal(response.statusCode, 200);
        return response.json().data.access_token as string;
      };
      const alice = await login('demo_alice');
      const bob = await login('demo_bob');
      const create = async (isGroup: boolean): Promise<{ dramaId: number; canvasId?: number }> => {
        const response = await request('POST', '/api/drama', alice, {
          parent_id: 0,
          is_group: isGroup,
          title: `Project ${randomUUID()}`,
        });
        assert.equal(response.status, 200);
        const dramaId = response.body.data.drama_id as number;
        createdIds.push(dramaId);
        return { dramaId, canvasId: response.body.data.canvas_id as number | undefined };
      };
      const firstGroup = (await create(true)).dramaId;
      const secondGroup = (await create(true)).dramaId;
      const firstProject = await create(false);
      const secondProject = await create(false);
      assert.ok(firstProject.canvasId);

      assert.equal(
        (
          await request('POST', '/api/drama/move', bob, {
            action: 'transfer',
            drama_id: firstProject.dramaId,
            target_id: firstGroup,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request('POST', '/api/drama/move', alice, {
            action: 'transfer',
            drama_id: firstGroup,
            target_id: secondGroup,
          })
        ).status,
        400,
      );
      const moved = await request('POST', '/api/drama/move', alice, {
        action: 'transfer',
        drama_id: firstProject.dramaId,
        target_id: firstGroup,
      });
      assert.equal(moved.status, 200);
      assert.deepEqual(moved.body.data.moved_ids, [firstProject.dramaId]);
      assert.equal(moved.body.data.parent_id, firstGroup);
      assert.equal(
        (
          await request('POST', '/api/drama/merge', alice, {
            ids: [firstProject.dramaId, secondProject.dramaId],
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request('POST', '/api/drama/batchMove', alice, {
            action: 'transfer',
            ids: [firstProject.dramaId, firstProject.dramaId],
            target_id: secondGroup,
          })
        ).status,
        400,
      );
      const batch = await request('POST', '/api/drama/batchMove', alice, {
        action: 'transfer',
        ids: [firstProject.dramaId, secondProject.dramaId],
        target_id: secondGroup,
      });
      assert.equal(batch.status, 200);
      assert.equal(batch.body.data.parent_id, secondGroup);
      assert.deepEqual(batch.body.data.moved_ids, [firstProject.dramaId, secondProject.dramaId]);
      assert.equal(
        (await request('GET', `/api/drama?parent_id=${firstGroup}`, alice)).body.data.total,
        0,
      );

      const merged = await request('POST', '/api/drama/merge', alice, {
        ids: [firstProject.dramaId, secondProject.dramaId],
      });
      assert.equal(merged.status, 200);
      const mergedGroup = merged.body.data.drama_id as number;
      createdIds.push(mergedGroup);
      const nested = await request('GET', `/api/drama?parent_id=${secondGroup}&all=1`, alice);
      assert.ok(
        nested.body.data.list.some(
          (item: { drama_id: number; is_group: boolean }) =>
            item.drama_id === mergedGroup && item.is_group,
        ),
      );
      const subset = await request('GET', '/api/drama/subset', alice);
      assert.ok(
        subset.body.data.list.some(
          (item: { drama_id: number }) => item.drama_id === firstProject.dramaId,
        ),
      );
      assert.equal(
        subset.body.data.list.some((item: { drama_id: number }) => item.drama_id === mergedGroup),
        false,
      );
      assert.equal(
        (await request('GET', '/api/drama/subset', bob)).body.data.list.some(
          (item: { drama_id: number }) => item.drama_id === firstProject.dramaId,
        ),
        false,
      );
      assert.equal(
        (
          await request('POST', '/api/drama/untie', alice, {
            ids: [secondGroup, mergedGroup],
          })
        ).status,
        409,
      );
      assert.equal(
        (await request('DELETE', '/api/drama', alice, { ids: [firstProject.dramaId] })).status,
        200,
      );
      const untied = await request('POST', '/api/drama/untie', alice, { ids: [mergedGroup] });
      assert.equal(untied.status, 200);
      assert.deepEqual(untied.body.data.untied_ids, [mergedGroup]);
      assert.equal(
        (
          await request('POST', '/api/project/recycle/restore', alice, {
            ids: [firstProject.dramaId],
          })
        ).status,
        200,
      );
      const children = await request('GET', `/api/drama?parent_id=${secondGroup}&all=2`, alice);
      assert.deepEqual(
        children.body.data.list
          .map((item: { drama_id: number }) => item.drama_id)
          .sort((left: number, right: number) => left - right),
        [firstProject.dramaId, secondProject.dramaId].sort((left, right) => left - right),
      );
      const removed = await request('POST', '/api/drama/batchMove', alice, {
        action: 'remove',
        ids: [firstProject.dramaId, secondProject.dramaId],
      });
      assert.equal(removed.status, 200);
      assert.equal(removed.body.data.parent_id, null);
      assert.equal(
        (await request('GET', `/api/drama/canvas/${firstProject.canvasId}`, alice)).status,
        200,
      );
      assert.equal(
        (await request('POST', '/api/drama/untie', alice, { ids: [firstGroup, secondGroup] }))
          .status,
        200,
      );
      assert.equal(
        (await request('GET', '/api/drama?parent_id=0&all=2', alice)).body.data.list.some(
          (item: { drama_id: number }) => item.drama_id === firstProject.dramaId,
        ),
        true,
      );
      const sourceGroup = (await create(true)).dramaId;
      const targetGroup = (await create(true)).dramaId;
      assert.equal(
        (
          await request('POST', '/api/drama/move', alice, {
            action: 'transfer',
            drama_id: firstProject.dramaId,
            target_id: sourceGroup,
          })
        ).status,
        200,
      );
      // 无论并发请求先后如何，移动成功的项目都不能再被原项目组删除。
      const [sourceDeleted, concurrentMove] = await Promise.all([
        request('DELETE', '/api/drama', alice, { ids: [sourceGroup] }),
        request('POST', '/api/drama/move', alice, {
          action: 'transfer',
          drama_id: firstProject.dramaId,
          target_id: targetGroup,
        }),
      ]);
      assert.equal(sourceDeleted.status, 200);
      assert.ok([200, 404].includes(concurrentMove.status));
      const canvasStatus = (
        await request('GET', `/api/drama/canvas/${firstProject.canvasId}`, alice)
      ).status;
      if (concurrentMove.status === 200) {
        assert.equal(canvasStatus, 200);
        assert.equal(
          (await request('GET', `/api/drama?parent_id=${targetGroup}&all=2`, alice)).body.data
            .list[0].drama_id,
          firstProject.dramaId,
        );
      } else {
        assert.equal(canvasStatus, 404);
      }
    } finally {
      try {
        if (createdIds.length) {
          // 解除失败时仍可清理嵌套项目组，避免影响后续集成测试。
          await db.query('UPDATE dramas SET parent_id=NULL WHERE id=ANY($1::int[])', [createdIds]);
          await db.query('DELETE FROM dramas WHERE id=ANY($1::int[])', [createdIds]);
        }
      } finally {
        await app.close();
      }
    }
  },
);
