import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  '作品发布校验归属，公开范围及克隆权限，活动报名按账号隔离',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    let dramaId: number | undefined;
    let clonedDramaId: number | undefined;
    let opusId: number | undefined;
    let activityId: number | undefined;
    const assetIds: number[] = [];
    let aliceAccountId: number | undefined;
    let bobAccountId: number | undefined;
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
      const login = async (username: string) => {
        const response = await request('POST', '/api/login/password', undefined, {
          username,
          password: 'Local-demo-123!',
        });
        assert.equal(response.status, 200);
        return response.body.data.access_token as string;
      };
      const alice = await login('demo_alice');
      const bob = await login('demo_bob');
      aliceAccountId = (await request('GET', '/api/user/info', alice)).body.data
        .account_id as number;
      bobAccountId = (await request('GET', '/api/user/info', bob)).body.data.account_id as number;
      const aliceUser = (
        await db.query<{ owner_user_id: number }>(
          'SELECT owner_user_id FROM accounts WHERE id=$1',
          [aliceAccountId],
        )
      ).rows[0].owner_user_id;
      const coverUrl = `mock://opus/${randomUUID()}.png`;
      const videoUrl = `mock://opus/${randomUUID()}.mp4`;
      for (const [url, mime] of [
        [coverUrl, 'image/png'],
        [videoUrl, 'video/mp4'],
      ]) {
        const asset = await db.query<{ id: number }>(
          'INSERT INTO media_assets(account_id,object_key,mime_type,size_byte,url,created_by) VALUES ($1,$2,$3,10,$4,$5) RETURNING id',
          [aliceAccountId, `opus/${randomUUID()}`, mime, url, aliceUser],
        );
        assetIds.push(asset.rows[0].id);
      }
      const drama = await request('POST', '/api/drama', alice, {
        parent_id: 0,
        is_group: false,
        title: '公开作品来源',
      });
      assert.equal(drama.status, 200);
      dramaId = drama.body.data.drama_id as number;
      const canvasId = drama.body.data.canvas_id as number;
      const types = await request('GET', '/api/opus/type');
      const typeId = types.body.data.list[0].type_id as number;
      const body = {
        drama_id: dramaId,
        canvas_id: canvasId,
        opus_name: '公开短剧',
        type_id: typeId,
        describe: '测试公开范围',
        cover_image: coverUrl,
        opus_video: videoUrl,
        allow_clone: false,
      };
      assert.equal((await request('POST', '/api/opus', bob, body)).status, 404);
      assert.equal(
        (
          await request('POST', '/api/opus', alice, {
            ...body,
            cover_image: 'https://elsewhere.invalid/cover.png',
          })
        ).status,
        404,
      );
      const published = await request('POST', '/api/opus', alice, body);
      assert.equal(published.status, 200);
      opusId = published.body.data.opus_id as number;
      assert.equal((await request('GET', `/api/opus/recommend/${opusId}`)).status, 200);
      assert.equal((await request('GET', `/api/opus/${opusId}`, bob)).status, 404);
      assert.equal(
        (await request('POST', '/api/opus/clone', bob, { opus_id: opusId })).status,
        404,
      );
      assert.equal((await request('GET', `/api/opus/process/${opusId}`)).status, 404);
      const edited = await request('POST', '/api/opus', alice, {
        ...body,
        opus_id: opusId,
        allow_clone: true,
      });
      assert.equal(edited.status, 200);
      const clone = await request('POST', '/api/opus/clone', bob, { opus_id: opusId });
      assert.equal(clone.status, 200);
      clonedDramaId = clone.body.data.drama_id as number;
      assert.ok(clonedDramaId !== dramaId);
      assert.equal(
        (
          await db.query('SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2', [
            clonedDramaId,
            bobAccountId,
          ])
        ).rowCount,
        1,
      );
      assert.equal(
        (
          await db.query('SELECT 1 FROM media_assets WHERE account_id=$1 AND origin_asset_id=$2', [
            bobAccountId,
            assetIds[0],
          ])
        ).rowCount,
        1,
      );
      const activity = await db.query<{ id: number }>(
        `INSERT INTO activities(title,status,start_at,end_at) VALUES ($1,2,now()-interval '1 day',now()+interval '1 day') RETURNING id`,
        [`征集-${randomUUID()}`],
      );
      activityId = activity.rows[0].id;
      const signupBody = {
        activity_id: activityId,
        entry_type: 1,
        contact_mobile: '13800000001',
        contact_email: 'alice@example.test',
        true_name: 'Alice',
        speciality: ['短剧'],
        opus: [],
        is_draft: false,
      };
      assert.equal((await request('POST', '/api/activity/signup', alice, signupBody)).status, 200);
      assert.equal(
        (await request('GET', `/api/activity/signup?activity_id=${activityId}`, bob)).status,
        404,
      );
      assert.equal(
        (await request('POST', '/api/activity/opus', bob, { ...body, activity_id: activityId }))
          .status,
        404,
      );
      assert.equal(
        (await request('POST', '/api/activity/opus', alice, { ...body, activity_id: activityId }))
          .status,
        200,
      );
    } finally {
      if (opusId)
        await db.query('DELETE FROM opuses WHERE id=$1 OR (activity_id=$2 AND account_id=$3)', [
          opusId,
          activityId ?? null,
          aliceAccountId ?? null,
        ]);
      if (activityId) await db.query('DELETE FROM activities WHERE id=$1', [activityId]);
      if (clonedDramaId) await db.query('DELETE FROM dramas WHERE id=$1', [clonedDramaId]);
      if (bobAccountId)
        await db.query(
          'DELETE FROM media_assets WHERE account_id=$1 AND origin_asset_id=ANY($2::int[])',
          [bobAccountId, assetIds],
        );
      if (dramaId) await db.query('DELETE FROM dramas WHERE id=$1', [dramaId]);
      if (assetIds.length)
        await db.query('DELETE FROM media_assets WHERE id=ANY($1::int[])', [assetIds]);
      await app.close();
    }
  },
);
