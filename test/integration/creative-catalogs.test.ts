import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test('运镜归属和公共目录收藏按用户隔离', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const app = await createApiApp();
  const db = app.get(Database);
  let cameraId: number | undefined;
  let styleId: number | undefined;
  let categoryId: number | undefined;
  let sceneCategoryId: number | undefined;
  const lightenPresetIds: number[] = [];
  let promptId: number | undefined;
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
      const result = await request('POST', '/api/login/password', undefined, {
        username,
        password: 'Local-demo-123!',
      });
      assert.equal(result.status, 200);
      return result.body.data.access_token as string;
    };
    const alice = await login('demo_alice');
    const bob = await login('demo_bob');
    const camera = await request('POST', '/api/camera', alice, {
      title: `运镜-${randomUUID()}`,
      prompt_text: '缓慢推进',
    });
    assert.equal(camera.status, 200);
    cameraId = camera.body.data.id as number;
    assert.equal(
      (await request('POST', '/api/camera/collect', bob, { id: cameraId, collect: true })).status,
      404,
    );
    assert.equal((await request('DELETE', '/api/camera', bob, { id: cameraId })).status, 404);
    assert.equal(
      (await request('POST', '/api/camera/collect', alice, { id: cameraId, collect: true })).status,
      200,
    );
    const mine = await request('GET', '/api/camera?query_type=3', alice);
    assert.ok(
      mine.body.data.list.some(
        (item: { id: number; is_collected: boolean }) => item.id === cameraId && item.is_collected,
      ),
    );
    const category = await db.query<{ id: number }>(
      'INSERT INTO image_style_categories(name) VALUES ($1) RETURNING id',
      [`风格-${randomUUID()}`],
    );
    categoryId = category.rows[0].id;
    const style = await db.query<{ id: number }>(
      'INSERT INTO image_styles(category_id,name,cover_image,support_models) VALUES ($1,$2,$3,$4) RETURNING id',
      [categoryId, '测试风格', 'mock://style/cover', JSON.stringify(['mock-image'])],
    );
    styleId = style.rows[0].id;
    assert.equal(
      (await request('POST', '/api/image/style/collect', alice, { style_id: styleId })).status,
      200,
    );
    assert.equal(
      (await request('GET', '/api/image/style/collection?page=1&limit=20', bob)).body.data.total,
      0,
    );
    assert.equal(
      (await request('GET', '/api/image/style/collection?page=1&limit=20', alice)).body.data.total,
      1,
    );
    assert.equal(
      (await request('POST', '/api/image/style/use', alice, { style_id: styleId })).status,
      200,
    );
    assert.equal(
      (await request('GET', '/api/image/style/recent?page=1&limit=20', alice)).body.data.total,
      1,
    );
    const sceneTitle = `场景-${randomUUID()}`;
    const sceneCategory = await db.query<{ id: number }>(
      'INSERT INTO image_scene_preset_categories(title,published) VALUES ($1,true) RETURNING id',
      [sceneTitle],
    );
    sceneCategoryId = sceneCategory.rows[0].id;
    await db.query(
      `INSERT INTO image_scene_presets(category_id,key,name,description,allow_model,published)
       VALUES ($1,$2,'已发布场景','测试场景',$3,true),($1,$4,'未发布场景','测试场景','[]',false)`,
      [
        sceneCategoryId,
        `scene-${randomUUID()}`,
        JSON.stringify([{ model_code: 'mock-image' }]),
        `scene-${randomUUID()}`,
      ],
    );
    const scenePresets = await request('GET', '/api/drama/canvas/image/scene', alice);
    assert.equal(scenePresets.status, 200);
    const sceneGroup = scenePresets.body.data.list.find(
      (item: { title: string }) => item.title === sceneTitle,
    );
    assert.ok(sceneGroup);
    assert.ok(sceneGroup.list.some((preset: { name: string }) => preset.name === '已发布场景'));
    assert.ok(!sceneGroup.list.some((preset: { name: string }) => preset.name === '未发布场景'));
    for (const published of [true, false]) {
      const preset = await db.query<{ id: number }>(
        `INSERT INTO lighten_presets(preset_name,brightness,published)
         VALUES ($1,65,$2) RETURNING id`,
        [published ? '已发布打光' : '未发布打光', published],
      );
      lightenPresetIds.push(preset.rows[0].id);
    }
    const lighten = await request('GET', '/api/lighten/preset', bob);
    assert.equal(lighten.status, 200);
    assert.ok(
      lighten.body.data.list.some((item: { id: number }) => item.id === lightenPresetIds[0]),
    );
    assert.ok(
      !lighten.body.data.list.some((item: { id: number }) => item.id === lightenPresetIds[1]),
    );
    const prompt = await db.query<{ id: number }>(
      `INSERT INTO prompt_templates(model_code,prompt_type,prompt_text)
       VALUES ('mock-image','text2image',$1) RETURNING id`,
      [`提示词-${randomUUID()}`],
    );
    promptId = prompt.rows[0].id;
    const model = await db.query<{ model_id: number }>(
      "SELECT model_id FROM model_catalog WHERE model_code='mock-image'",
    );
    const prompts = await request(
      'GET',
      `/api/prompt?page=1&limit=20&model_id=${model.rows[0].model_id}`,
      alice,
    );
    assert.equal(prompts.status, 200);
    assert.ok(
      prompts.body.data.list.some((item: { prompt_id: number }) => item.prompt_id === promptId),
    );
  } finally {
    if (promptId) await db.query('DELETE FROM prompt_templates WHERE id=$1', [promptId]);
    if (styleId) await db.query('DELETE FROM image_styles WHERE id=$1', [styleId]);
    if (categoryId) await db.query('DELETE FROM image_style_categories WHERE id=$1', [categoryId]);
    if (sceneCategoryId)
      await db.query('DELETE FROM image_scene_preset_categories WHERE id=$1', [sceneCategoryId]);
    if (lightenPresetIds.length)
      await db.query('DELETE FROM lighten_presets WHERE id=ANY($1::int[])', [lightenPresetIds]);
    if (cameraId) await db.query('DELETE FROM camera_motions WHERE id=$1', [cameraId]);
    await app.close();
  }
});
