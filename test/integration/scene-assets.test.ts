import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  '场景执行先验证项目和媒体归属，资产删除保护项目引用',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    let dramaId: number | undefined;
    let assetId: number | undefined;
    let spareId: number | undefined;
    const publicAssetIds: number[] = [];
    try {
      const request = async (
        method: 'GET' | 'POST' | 'DELETE',
        url: string,
        token?: string,
        payload?: Record<string, unknown>,
      ) => {
        const result = await app.inject({
          method,
          url,
          headers: token ? { authorization: `Bearer ${token}` } : {},
          payload,
        });
        return { status: result.statusCode, body: result.json() };
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
      const alice = aliceLogin.body.data.access_token as string;
      const bob = bobLogin.body.data.access_token as string;
      const accountId = (await request('GET', '/api/user/info', alice)).body.data
        .account_id as number;
      const ownerId = (
        await db.query<{ owner_user_id: number }>(
          'SELECT owner_user_id FROM accounts WHERE id=$1',
          [accountId],
        )
      ).rows[0].owner_user_id;
      const ownerUuid = (
        await db.query<{ uuid: string }>('SELECT uuid::text FROM users WHERE id=$1', [ownerId])
      ).rows[0].uuid;
      const uploadBody = {
        category: 'image',
        origin_name: 'image.png',
        object_name: 'image.png',
        hash: 'a'.repeat(64),
        mime_type: 'image/png',
        storage_path: `web-upload/${ownerUuid}/canvas/image/`,
        suffix: '.png',
        size_byte: 12,
        url: `https://cdn.example.test/web-upload/${ownerUuid}/canvas/image/image.png`,
      };
      assert.equal(
        (
          await request('POST', '/api/upload/data', alice, {
            ...uploadBody,
            mime_type: 'video/mp4',
          })
        ).status,
        400,
      );
      assert.equal((await request('POST', '/api/upload/data', bob, uploadBody)).status, 404);
      assert.equal((await request('POST', '/api/upload/data', alice, uploadBody)).status, 503);
      const imageUrl = `mock://scene/${randomUUID()}.png`;
      const spareUrl = `mock://scene/${randomUUID()}-spare.png`;
      const created = await db.query<{ id: number }>(
        `INSERT INTO media_assets(account_id,object_key,mime_type,size_byte,url,created_by)
       VALUES ($1,$2,'image/png',12,$3,$4) RETURNING id`,
        [accountId, `scene/${randomUUID()}`, imageUrl, ownerId],
      );
      assetId = created.rows[0].id;
      const spare = await db.query<{ id: number }>(
        `INSERT INTO media_assets(account_id,object_key,mime_type,size_byte,url,created_by)
       VALUES ($1,$2,'image/png',12,$3,$4) RETURNING id`,
        [accountId, `scene/${randomUUID()}`, spareUrl, ownerId],
      );
      spareId = spare.rows[0].id;
      const drama = await request('POST', '/api/drama', alice, {
        parent_id: 0,
        is_group: false,
        title: '场景归属',
      });
      assert.equal(drama.status, 200);
      dramaId = drama.body.data.drama_id as number;
      const canvasId = drama.body.data.canvas_id as number;
      const saved = await request('POST', '/api/node/batch', alice, {
        drama_id: dramaId,
        canvas_id: canvasId,
        expected_version: 0,
        nodes: {
          create: [
            {
              uuid: `scene-${randomUUID()}`,
              type: 'image',
              node_name: '图片',
              position: { x: 0, y: 0 },
              content: imageUrl,
            },
          ],
        },
      });
      assert.equal(saved.status, 200);
      const nodeId = saved.body.data.nodes.create[0].node_id as number;
      const body = { drama_id: dramaId, node_id: nodeId, image: imageUrl };
      assert.equal((await request('POST', '/api/scene/matting', bob, body)).status, 404);
      assert.equal(
        (
          await request('POST', '/api/scene/matting', alice, {
            ...body,
            image: 'https://elsewhere.invalid/image.png',
          })
        ).status,
        404,
      );
      assert.equal((await request('POST', '/api/scene/matting', alice, body)).status, 503);
      assert.equal(
        (await request('POST', '/api/node/download', bob, { node_id: nodeId })).status,
        404,
      );
      assert.equal(
        (await request('POST', '/api/node/download', alice, { node_id: nodeId, index: -1 })).status,
        400,
      );
      assert.equal(
        (await request('POST', '/api/node/download', alice, { node_id: nodeId })).status,
        503,
      );
      const workflow = {
        project_id: dramaId,
        document: {
          schemaVersion: 1,
          version: 0,
          rootNodeIds: [],
          terminalNodeIds: [],
          nodes: [],
          edges: [],
        },
      };
      assert.equal((await request('POST', '/api/workflow/execute', alice, workflow)).status, 503);
      assert.equal(
        (await request('POST', '/api/workflow/execute', alice, { document: workflow.document }))
          .status,
        400,
      );
      const grouped = await request('GET', '/api/asset?page=1&limit=20', alice);
      assert.equal(grouped.status, 200);
      assert.ok(
        Object.values(grouped.body.data)
          .flat()
          .some((item: unknown) => (item as { asset_id?: number }).asset_id === assetId),
      );
      const picker = await request(
        'GET',
        '/api/asset?page=1&limit=20&belong_type=private&format=picture',
        alice,
      );
      assert.equal(picker.status, 200);
      assert.ok(
        picker.body.data.list.some((item: { asset_id: number }) => item.asset_id === assetId),
      );
      let publicAssetUrl = '';
      for (const published of [true, false]) {
        const assetUrl = `https://cdn.example.test/public/${randomUUID()}.png`;
        if (published) publicAssetUrl = assetUrl;
        const publicAsset = await db.query<{ id: number }>(
          `INSERT INTO public_media_assets(object_key,mime_type,url,title,size_byte,published)
           VALUES ($1,'image/png',$2,$3,12,$4) RETURNING id`,
          [
            `public/${randomUUID()}`,
            assetUrl,
            published ? '公开素材测试' : '未公开素材测试',
            published,
          ],
        );
        publicAssetIds.push(publicAsset.rows[0].id);
      }
      const publicAssets = await request(
        'GET',
        '/api/asset?belong_type=public&format=picture&page=1&limit=20&keyword=素材测试',
        bob,
      );
      assert.equal(publicAssets.status, 200);
      assert.ok(
        publicAssets.body.data.list.some(
          (item: { asset_id: number }) => item.asset_id === publicAssetIds[0],
        ),
      );
      assert.ok(
        !publicAssets.body.data.list.some(
          (item: { asset_id: number }) => item.asset_id === publicAssetIds[1],
        ),
      );
      assert.equal(
        (await request('POST', '/api/scene/matting', alice, { ...body, image: publicAssetUrl }))
          .status,
        503,
      );
      const generationQuote = {
        drama_id: dramaId,
        canvas_id: canvasId,
        node_id: nodeId,
        node_type: 'image',
        task_type: 'image',
        model_code: 'mock-image',
        mode_type: 'image2image',
        inputs: { prompt: 'test', images: [publicAssetUrl], videos: [], audios: [], texts: [] },
        parameters: { ratio: '1:1', count: 1 },
        features: {},
      };
      const quote = await request('POST', '/api/node/credit', alice, generationQuote);
      assert.equal(quote.status, 200);
      assert.equal(quote.body.data.credit, 8);
      assert.equal(
        (
          await request('POST', '/api/node/credit', alice, {
            ...generationQuote,
            inputs: { ...generationQuote.inputs, images: ['https://elsewhere.invalid/test.png'] },
          })
        ).status,
        404,
      );
      assert.equal((await request('DELETE', '/api/asset', alice, { ids: [assetId] })).status, 409);
      assert.equal((await request('DELETE', '/api/asset', bob, { ids: [assetId] })).status, 404);
      assert.equal((await request('DELETE', '/api/asset', alice, { ids: [spareId] })).status, 200);
      spareId = undefined;
    } finally {
      if (dramaId) await db.query('DELETE FROM dramas WHERE id=$1', [dramaId]);
      if (assetId) await db.query('DELETE FROM media_assets WHERE id=$1', [assetId]);
      if (spareId) await db.query('DELETE FROM media_assets WHERE id=$1', [spareId]);
      if (publicAssetIds.length)
        await db.query('DELETE FROM public_media_assets WHERE id=ANY($1::int[])', [publicAssetIds]);
      await app.close();
    }
  },
);
