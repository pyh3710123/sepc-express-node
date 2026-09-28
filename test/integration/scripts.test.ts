import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  'scripts persist steps, reject stale versions and import personal copies',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const app = await createApiApp();
    const db = app.get(Database);
    let teamId: number | undefined;
    let personalScriptId: number | undefined;
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
      const alicePersonal = aliceLogin.body.data.access_token as string;
      const bobPersonal = bobLogin.body.data.access_token as string;
      const personalCreated = await request('POST', '/api/script', alicePersonal, {
        input_text: '一段个人创意',
        attr_ids: '',
        model_code: 'draft-only',
        title: '个人原稿',
        episode_count: 8,
        episode_duration: 2,
      });
      assert.equal(personalCreated.status, 200);
      personalScriptId = personalCreated.body.data.script_id as number;
      const personalDetail = await request('GET', `/api/script/${personalScriptId}`, alicePersonal);
      assert.equal(personalDetail.body.data.steps.length, 7);
      const firstStepId = personalDetail.body.data.steps[0].step_id as number;
      const edited = await request('PUT', '/api/script/update', alicePersonal, {
        script_id: personalScriptId,
        step_id: firstStepId,
        content: '故事背景内容',
        expected_version: 1,
      });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.data.version, 2);
      assert.equal(
        (
          await request('PUT', '/api/script/update', alicePersonal, {
            script_id: personalScriptId,
            step_id: firstStepId,
            content: '过期覆盖',
            expected_version: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request('PUT', '/api/script/confirmStep', alicePersonal, {
            script_id: personalScriptId,
            step_id: firstStepId,
            expected_version: 2,
          })
        ).status,
        200,
      );
      const createdTeam = await request('POST', '/api/account', alicePersonal, {
        name: `Script ${randomUUID()}`,
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
      const imported = await request('POST', '/api/script/import', alice, {
        ids: [personalScriptId],
      });
      assert.equal(imported.status, 200);
      const teamScriptId = imported.body.data.imported_ids[0] as number;
      assert.notEqual(teamScriptId, personalScriptId);
      const teamDetail = await request('GET', `/api/script/${teamScriptId}`, alice);
      assert.equal(teamDetail.body.data.steps[0].content, '故事背景内容');
      assert.equal(teamDetail.body.data.steps[0].has_confirmed, 1);
      assert.equal(
        (
          await request('POST', '/api/data/permission/project', alice, {
            can_create: true,
            assets_share: false,
            project_type: 'script',
            project_id: teamScriptId,
            list: [{ user_id: bobUser.rows[0].id, permission_code: 'viewer' }],
          })
        ).status,
        200,
      );
      assert.equal((await request('GET', `/api/script/${teamScriptId}`, bob)).status, 200);
      assert.equal(
        (await request('PUT', '/api/script', bob, { script_id: teamScriptId, title: '无权改名' }))
          .status,
        403,
      );
      assert.equal(
        (await request('PUT', '/api/script/generate', alice, { script_id: teamScriptId, step: 2 }))
          .status,
        503,
      );
      assert.equal((await request('PUT', `/api/script/${teamScriptId}`, bob)).status, 403);
      assert.equal((await request('PUT', `/api/script/${teamScriptId}`, alice)).status, 200);
      assert.equal((await request('GET', `/api/script/${teamScriptId}`, alice)).status, 404);
      assert.equal(
        (await request('PUT', `/api/script/restore/${teamScriptId}`, alice)).status,
        200,
      );
      assert.equal((await request('GET', `/api/script/${teamScriptId}`, alice)).status, 200);
    } finally {
      if (teamId) {
        await db.query('DELETE FROM scripts WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [teamId]);
      }
      if (personalScriptId) await db.query('DELETE FROM scripts WHERE id=$1', [personalScriptId]);
      await app.close();
    }
  },
);
