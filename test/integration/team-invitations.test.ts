import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Database } from '../../src/database';
import { createApiApp } from '../../src/main';

test(
  'team invitation applies custom role and project permission atomically',
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
      const alicePersonal = aliceLogin.body.data.access_token as string;
      const bobPersonal = bobLogin.body.data.access_token as string;
      const createdTeam = await request('POST', '/api/account', alicePersonal, {
        name: `Invite ${randomUUID()}`,
        intro: '',
      });
      assert.equal(createdTeam.status, 200);
      teamId = createdTeam.body.data.account_id as number;
      const switched = await request('POST', '/api/account/change', alicePersonal, {
        account_id: teamId,
      });
      assert.equal(switched.status, 200);
      const alice = switched.body.data.access_token as string;
      const drama = await request('POST', '/api/drama', alice, {
        parent_id: 0,
        is_group: false,
        title: '被邀请项目',
      });
      const dramaId = drama.body.data.drama_id as number;
      const canvasId = drama.body.data.canvas_id as number;
      const role = await request('POST', '/api/account/role', alice, { role_name: '创作成员' });
      assert.equal(role.status, 200);
      const roleId = role.body.data.role_id as number;
      const invitation = await request('POST', '/api/account/invite', alice, {
        mobile: '13800000002',
        role_id: roleId,
        permissions: [{ project_type: 'drama', project_id: dramaId, permission_code: 'viewer' }],
      });
      assert.equal(invitation.status, 200);
      const inviteId = invitation.body.data.invite_id as number;
      assert.equal(
        (await request('POST', '/api/account/accept', alice, { invite_id: inviteId, accept: true }))
          .status,
        404,
      );
      assert.equal(
        (
          await request('POST', '/api/account/accept', bobPersonal, {
            invite_id: inviteId,
            accept: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request('POST', '/api/account/accept', bobPersonal, {
            invite_id: inviteId,
            accept: true,
          })
        ).status,
        404,
      );
      const bobSwitch = await request('POST', '/api/account/change', bobPersonal, {
        account_id: teamId,
      });
      assert.equal(bobSwitch.status, 200);
      const bob = bobSwitch.body.data.access_token as string;
      const memberInfo = await request('GET', '/api/user/info', bob);
      assert.equal(memberInfo.body.data.role_name, '创作成员');
      assert.equal(memberInfo.body.data.is_admin, false);
      assert.equal((await request('GET', `/api/drama/canvas/${canvasId}`, bob)).status, 200);
      assert.equal(
        (await request('PUT', '/api/drama', bob, { drama_id: dramaId, title: '不可编辑' })).status,
        403,
      );
      assert.equal((await request('DELETE', `/api/account/role/${roleId}`, alice)).status, 409);
      const members = await request('GET', '/api/account/member', alice);
      const bobId = members.body.data.list.find(
        (item: { role_name: string }) => item.role_name === '创作成员',
      ).user_id as number;
      assert.equal(
        (await request('POST', '/api/account/remove', alice, { target_uid: bobId })).status,
        200,
      );
      assert.equal((await request('GET', '/api/user/info', bob)).status, 401);
      assert.equal((await request('DELETE', `/api/account/role/${roleId}`, alice)).status, 200);
    } finally {
      if (teamId) {
        await db.query('DELETE FROM dramas WHERE account_id=$1', [teamId]);
        await db.query('DELETE FROM accounts WHERE id=$1', [teamId]);
      }
      await app.close();
    }
  },
);
