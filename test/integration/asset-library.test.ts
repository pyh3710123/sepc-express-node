import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  'asset libraries validate source ownership, media references and team sharing',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    let teamId: number | undefined;
    try {
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
      const createdTeam = await request('POST', '/api/account', alicePersonal, {
        name: `Library ${randomUUID()}`,
        intro: '',
      });
      assert.equal(createdTeam.status, 200);
      teamId = createdTeam.body.data.account_id as number;
      const bobUser = await db.query<{ id: number }>(
        "SELECT id FROM users WHERE username='demo_bob'",
      );
      await db.query(
        `INSERT INTO account_members(account_id,user_id,role) VALUES ($1,$2,'member')`,
        [teamId, bobUser.rows[0].id],
      );
      const aliceSwitch = await request('POST', '/api/account/change', alicePersonal, {
        account_id: teamId,
      });
      const bobSwitch = await request('POST', '/api/account/change', bobPersonal, {
        account_id: teamId,
      });
      const alice = aliceSwitch.body.data.access_token as string;
      const bob = bobSwitch.body.data.access_token as string;
      const aliceOutsideLogin = await request('POST', '/api/login/password', undefined, {
        username: 'demo_alice',
        password: 'Local-demo-123!',
      });
      const aliceOutside = aliceOutsideLogin.body.data.access_token as string;
      const imageUrl = `mock://library/${randomUUID()}.png`;
      const audioUrl = `mock://library/${randomUUID()}.mp3`;
      for (const [url, mime] of [
        [imageUrl, 'image/png'],
        [audioUrl, 'audio/mpeg'],
      ])
        await db.query(
          'INSERT INTO media_assets(account_id,object_key,mime_type,size_byte,url) VALUES ($1,$2,$3,10,$4)',
          [teamId, `library/${randomUUID()}`, mime, url],
        );
      const drama = await request('POST', '/api/drama', alice, {
        parent_id: 0,
        is_group: false,
        title: '素材来源',
      });
      const dramaId = drama.body.data.drama_id as number;
      const canvasId = drama.body.data.canvas_id as number;
      const node = await request('POST', '/api/node/batch', alice, {
        drama_id: dramaId,
        canvas_id: canvasId,
        expected_version: 0,
        nodes: {
          create: [
            {
              uuid: `node-${randomUUID()}`,
              type: 'image',
              node_name: '图片',
              position: { x: 0, y: 0 },
              content: imageUrl,
            },
          ],
        },
      });
      assert.equal(node.status, 200);
      const nodeId = node.body.data.nodes.create[0].node_id as number;
      const createdMaterial = await request('POST', '/api/material', alice, {
        category: 'scene',
        mime_type: 'image/png',
        material_name: '场景',
        content: imageUrl,
        cover_image: imageUrl,
        node_id: nodeId,
      });
      assert.equal(createdMaterial.status, 200);
      const materialId = createdMaterial.body.data.material_id as number;
      assert.equal((await request('GET', `/api/material/${materialId}`, aliceOutside)).status, 404);
      assert.equal((await request('GET', `/api/material/${materialId}`, bob)).status, 404);
      assert.equal(
        (
          await request('POST', '/api/data/permission', alice, {
            can_create: true,
            assets_share: true,
          })
        ).status,
        200,
      );
      assert.equal((await request('GET', `/api/material/${materialId}`, bob)).status, 200);
      assert.equal(
        (
          await request('POST', '/api/material', bob, {
            category: 'scene',
            mime_type: 'image/png',
            material_name: '假媒体',
            content: 'https://elsewhere.invalid/image.png',
            cover_image: '',
            node_id: nodeId,
          })
        ).status,
        404,
      );
      const timbre = await request('POST', '/api/subject/timbre', bob, {
        audio_url: audioUrl,
        timbre_name: '音色',
      });
      assert.equal(timbre.status, 200);
      const timbreId = timbre.body.data.timbre_id as number;
      const subject = await request('POST', '/api/subject', bob, {
        category: 'character',
        content: [imageUrl],
        description: '测试角色',
        timbre_id: timbreId,
        subject_name: '角色',
        is_image: true,
      });
      assert.equal(subject.status, 200);
      const subjectId = subject.body.data.subject_id as number;
      assert.equal((await request('GET', `/api/subject/${subjectId}`, alice)).status, 200);
      const invalidSubject = await request('PUT', '/api/subject', bob, {
        subject_id: subjectId,
        category: 'character',
        content: [imageUrl, 'https://elsewhere.invalid/image.png'],
        description: '污染更新',
        timbre_id: timbreId,
        subject_name: '角色',
        is_image: true,
      });
      assert.equal(invalidSubject.status, 404);
      const detail = await request('GET', `/api/subject/${subjectId}`, bob);
      assert.deepEqual(detail.body.data.content, [imageUrl]);
      const libraryNode = await request('POST', '/api/canvas/node', bob, {
        title: '节点快照',
        parent_node_id: nodeId,
        tags: ['场景'],
      });
      assert.equal(libraryNode.status, 200);
      assert.equal(
        (await request('GET', `/api/canvas/node/${libraryNode.body.data.id}`, bob)).status,
        200,
      );
      assert.equal(
        (await request('DELETE', '/api/material', bob, { ids: [materialId] })).status,
        404,
      );
      assert.equal((await request('GET', `/api/material/${materialId}`, alice)).status, 200);
    } finally {
      if (teamId) {
        await db.query('DELETE FROM materials WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM subjects WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM subject_timbres WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM canvas_library_nodes WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM dramas WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM media_assets WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [teamId]);
      }
      await app.close();
    }
  },
);
