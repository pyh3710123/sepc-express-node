import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GenerationService } from '../../src/generation';
import { createApiApp } from '../../src/main';

test(
  'PostgreSQL contracts: auth rotation, tenant isolation, canvas CAS, ledger idempotency and worker completion',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
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
      assert.equal(aliceLogin.status, 200);
      const oldRefresh = aliceLogin.body.data.refresh_token as string;
      const rotated = await request('POST', '/api/auth/refresh', oldRefresh);
      assert.equal(rotated.status, 200);
      assert.equal((await request('POST', '/api/auth/refresh', oldRefresh)).status, 401);
      const alicePersonal = rotated.body.data.access_token as string;
      const accounts = await request('GET', '/api/account', alicePersonal);
      const team = accounts.body.data.list.find(
        (row: { account_type: string }) => row.account_type === 'team',
      ).account_id as number;
      const switched = await request('POST', '/api/account/change', alicePersonal, {
        account_id: team,
      });
      assert.equal(switched.status, 200);
      assert.equal((await request('GET', '/api/user/info', alicePersonal)).status, 401);
      const alice = switched.body.data.access_token as string;

      const dramas = await request('GET', '/api/drama', alice);
      const dramaId = dramas.body.data.list[0].drama_id as number;
      const options = await request('GET', `/api/drama/canvas/options?drama_id=${dramaId}`, alice);
      const canvasId = options.body.data.list[0].canvas_id as number;
      const initial = await request('GET', `/api/drama/canvas/${canvasId}`, alice);
      assert.equal(initial.body.data.version, 0);
      const imageNode = initial.body.data.nodes.find(
        (node: { uuid: string }) => node.uuid === 'demo-image',
      ).node_id as number;

      const bobLogin = await request('POST', '/api/login/password', undefined, {
        username: 'demo_bob',
        password: 'Local-demo-123!',
      });
      const bobPersonal = bobLogin.body.data.access_token as string;
      assert.equal(
        (await request('GET', `/api/drama/canvas/${canvasId}`, bobPersonal)).status,
        404,
      );

      const marker = randomUUID().slice(0, 8);
      const groupUuid = `group-${marker}`;
      const childUuid = `child-${marker}`;
      const edgeUuid = `edge-${marker}`;
      const batch = {
        drama_id: dramaId,
        canvas_id: canvasId,
        expected_version: 0,
        nodes: {
          create: [
            {
              uuid: groupUuid,
              type: 'group',
              node_name: 'Group',
              position: { x: 10, y: 10 },
              size: { width: 600, height: 400 },
            },
            {
              uuid: childUuid,
              type: 'text',
              node_name: 'Text',
              position: { x: 20, y: 20 },
              parent_uuid: groupUuid,
              content: '正文',
            },
          ],
        },
        connections: {
          create: [{ uuid: edgeUuid, source_uuid: 'demo-text', target_uuid: childUuid }],
        },
      };
      const saved = await request('POST', '/api/node/batch', alice, batch);
      assert.equal(saved.status, 200);
      assert.equal(saved.body.data.version, 1);
      assert.equal(saved.body.data.nodes.create.length, 2);
      const conflict = await request('POST', '/api/node/batch', alice, batch);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.data.current_version, 1);
      const viewport = await request('PUT', `/api/drama/canvas/${canvasId}`, alice, {
        x: 120,
        y: -40,
        window_zoom_rate: 206,
      });
      assert.equal(viewport.status, 200);
      const afterViewport = await request('GET', `/api/drama/canvas/${canvasId}`, alice);
      assert.equal(afterViewport.body.data.version, 1);
      assert.equal(afterViewport.body.data.settings.window_zoom_rate, 206);
      assert.equal(
        afterViewport.body.data.nodes.find((node: { uuid: string }) => node.uuid === childUuid)
          .content,
        '正文',
      );
      const badEdge = await request('POST', '/api/node/batch', alice, {
        drama_id: dramaId,
        canvas_id: canvasId,
        expected_version: 1,
        connections: {
          create: [{ uuid: `bad-${marker}`, source_uuid: 'missing', target_uuid: childUuid }],
        },
      });
      assert.equal(badEdge.status, 400);
      assert.equal(
        (await request('GET', `/api/drama/canvas/${canvasId}`, alice)).body.data.version,
        1,
      );
      const groupId = saved.body.data.nodes.create.find(
        (node: { uuid: string }) => node.uuid === groupUuid,
      ).node_id as number;
      const deleted = await request('POST', '/api/node/batch', alice, {
        drama_id: dramaId,
        canvas_id: canvasId,
        expected_version: 1,
        nodes: { delete: [{ id: groupId }] },
      });
      assert.equal(deleted.status, 200);
      assert.equal(deleted.body.data.deleted_node_ids.length, 2);
      assert.equal(deleted.body.data.deleted_connection_ids.length, 1);

      const generationInput = {
        request_id: randomUUID(),
        drama_id: dramaId,
        canvas_id: canvasId,
        node_id: imageNode,
        node_type: 'image',
        task_type: 'image',
        model_code: 'mock-image',
        mode_type: 'text2image',
        inputs: { prompt: 'cat', images: [], videos: [], audios: [], texts: [] },
        parameters: { ratio: '16:9', count: 2 },
        features: {},
      };
      const quote = await request('POST', '/api/node/credit', alice, generationInput);
      assert.equal(quote.body.data.credit, 10);
      const before = (await request('GET', '/api/credit', alice)).body.data.total_balance as number;
      const created = await request('POST', '/api/task/generation/create', alice, generationInput);
      assert.equal(created.status, 200);
      const replay = await request('POST', '/api/task/generation/create', alice, generationInput);
      assert.equal(replay.body.data.task_id, created.body.data.task_id);
      assert.equal(
        (await request('GET', '/api/credit', alice)).body.data.total_balance,
        before - 10,
      );
      const altered = await request('POST', '/api/task/generation/create', alice, {
        ...generationInput,
        parameters: { ratio: '1:1', count: 2 },
      });
      assert.equal(altered.status, 409);
      await app.get(GenerationService).runMockTask(created.body.data.task_id);
      const progress = await request('POST', '/api/task/generation/progress', alice, {
        task_ids: [created.body.data.task_id],
      });
      assert.equal(progress.body.data.list[0].status, 'completed');
      assert.equal(progress.body.data.list[0].result.mock, true);
      const next = await request('POST', '/api/task/generation/create', alice, {
        ...generationInput,
        request_id: randomUUID(),
      });
      const canceled = await request('POST', '/api/task/generation/cancel', alice, {
        task_id: next.body.data.task_id,
      });
      assert.equal(canceled.body.data.status, 'canceled');
      assert.equal(
        (await request('GET', '/api/credit', alice)).body.data.total_balance,
        before - 10,
      );
    } finally {
      await app.close();
    }
  },
);
