import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  'personal project import copies tree and asset registrations without moving originals',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    let teamId: number | undefined;
    const personalDramaIds: number[] = [];
    let personalAssetId: number | undefined;
    let publicAssetId: number | undefined;
    try {
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
      const login = await request('POST', '/api/login/password', undefined, {
        username: 'demo_alice',
        password: 'Local-demo-123!',
      });
      assert.equal(login.status, 200);
      const personal = login.body.data.access_token as string;
      const account = await request('GET', '/api/user/info', personal);
      const personalAccountId = account.body.data.account_id as number;
      const group = await request('POST', '/api/drama', personal, {
        parent_id: 0,
        is_group: true,
        title: `个人组 ${randomUUID()}`,
      });
      assert.equal(group.status, 200);
      const groupId = group.body.data.drama_id as number;
      personalDramaIds.push(groupId);
      const source = await request('POST', '/api/drama', personal, {
        parent_id: groupId,
        is_group: false,
        title: '个人短剧',
      });
      assert.equal(source.status, 200);
      const sourceId = source.body.data.drama_id as number;
      const sourceCanvasId = source.body.data.canvas_id as number;
      const url = `mock://import/${randomUUID()}.png`;
      const objectKey = `import/${randomUUID()}.png`;
      const asset = await db.query<{ id: number }>(
        'INSERT INTO media_assets(account_id,object_key,mime_type,size_byte,url) VALUES ($1,$2,$3,20,$4) RETURNING id',
        [personalAccountId, objectKey, 'image/png', url],
      );
      personalAssetId = asset.rows[0].id;
      const publicUrl = `https://cdn.example.test/public/${randomUUID()}.png`;
      const publicAsset = await db.query<{ id: number }>(
        `INSERT INTO public_media_assets(object_key,mime_type,url,title,size_byte,published)
         VALUES ($1,'image/png',$2,'可共享素材',20,true) RETURNING id`,
        [`public/${randomUUID()}`, publicUrl],
      );
      publicAssetId = publicAsset.rows[0].id;
      const node = await request('POST', '/api/node/batch', personal, {
        drama_id: sourceId,
        canvas_id: sourceCanvasId,
        expected_version: 0,
        nodes: {
          create: [
            {
              uuid: `node-${randomUUID()}`,
              type: 'image',
              node_name: '导入图像',
              position: { x: 0, y: 0 },
              content: url,
              extra_data: { asset_id: personalAssetId },
            },
            {
              uuid: `node-${randomUUID()}`,
              type: 'image',
              node_name: '公共素材',
              position: { x: 100, y: 0 },
              content: publicUrl,
            },
          ],
        },
      });
      assert.equal(node.status, 200);
      const createdTeam = await request('POST', '/api/account', personal, {
        name: `Import ${randomUUID()}`,
        intro: '',
      });
      assert.equal(createdTeam.status, 200);
      teamId = createdTeam.body.data.account_id as number;
      const switched = await request('POST', '/api/account/change', personal, {
        account_id: teamId,
      });
      assert.equal(switched.status, 200);
      const team = switched.body.data.access_token as string;
      const personalList = await request('GET', '/api/drama/personal?page=1&limit=100', team);
      assert.equal(personalList.status, 200);
      assert.ok(
        personalList.body.data.list.some((item: { drama_id: number }) => item.drama_id === groupId),
      );
      const imported = await request('POST', '/api/drama/import', team, {
        parent_id: 0,
        ids: [groupId],
      });
      assert.equal(imported.status, 200);
      const importedGroupId = imported.body.data.imported_ids[0] as number;
      assert.notEqual(importedGroupId, groupId);
      const children = await db.query<{ id: number }>(
        'SELECT id FROM dramas WHERE parent_id=$1 AND account_id=$2',
        [importedGroupId, teamId],
      );
      assert.equal(children.rows.length, 1);
      const importedCanvas = await db.query<{ id: number }>(
        'SELECT id FROM canvases WHERE drama_id=$1',
        [children.rows[0].id],
      );
      assert.equal(importedCanvas.rows.length, 1);
      const importedDetail = await request(
        'GET',
        `/api/drama/canvas/${importedCanvas.rows[0].id}`,
        team,
      );
      assert.equal(importedDetail.status, 200);
      assert.equal(importedDetail.body.data.nodes.length, 2);
      assert.ok(
        importedDetail.body.data.nodes.some(
          (item: { content: string }) => item.content === publicUrl,
        ),
      );
      const copiedAsset = await db.query<{ id: number; object_key: string; url: string }>(
        'SELECT id,object_key,url FROM media_assets WHERE account_id=$1 AND object_key=$2',
        [teamId, objectKey],
      );
      assert.equal(copiedAsset.rows.length, 1);
      assert.equal(copiedAsset.rows[0].url, url);
      assert.notEqual(copiedAsset.rows[0].id, personalAssetId);
      assert.ok(
        importedDetail.body.data.nodes.some(
          (item: { extra_data: { asset_id?: number } }) =>
            item.extra_data.asset_id === copiedAsset.rows[0].id,
        ),
      );
      assert.equal(
        (
          await db.query('SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2', [
            teamId,
            publicUrl,
          ])
        ).rowCount,
        0,
      );
      const freshPersonalLogin = await request('POST', '/api/login/password', undefined, {
        username: 'demo_alice',
        password: 'Local-demo-123!',
      });
      const freshPersonal = freshPersonalLogin.body.data.access_token as string;
      assert.equal(
        (await request('GET', `/api/drama/canvas/${sourceCanvasId}`, freshPersonal)).status,
        200,
      );
      assert.equal(
        (await request('GET', `/api/drama/canvas/${importedCanvas.rows[0].id}`, freshPersonal))
          .status,
        404,
      );
      const originalAsset = await db.query(
        'SELECT 1 FROM media_assets WHERE id=$1 AND account_id=$2',
        [personalAssetId, personalAccountId],
      );
      assert.equal(originalAsset.rowCount, 1);
    } finally {
      if (teamId) {
        await db.query('DELETE FROM dramas WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM media_assets WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [teamId]);
      }
      if (personalDramaIds.length) {
        await db.query('DELETE FROM dramas WHERE parent_id=ANY($1::int[])', [personalDramaIds]);
        await db.query('DELETE FROM dramas WHERE id=ANY($1::int[])', [personalDramaIds]);
      }
      if (personalAssetId)
        await db.query('DELETE FROM media_assets WHERE id=$1', [personalAssetId]);
      if (publicAssetId)
        await db.query('DELETE FROM public_media_assets WHERE id=$1', [publicAssetId]);
      await app.close();
    }
  },
);
