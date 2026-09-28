import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import type { z } from 'zod';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';
import { PermissionsService } from '../permissions/permissions.service';
import type { invite } from './teams.schemas';

interface RoleRow extends QueryResultRow {
  role_id: number;
  role_name: string;
  is_custom: boolean;
}

interface InvitationRow extends QueryResultRow {
  id: number;
  account_id: number;
  target_user_id: number;
  role_id: number;
  role_kind: 'admin' | 'member' | 'custom';
  permissions: Array<{
    project_type: 'drama' | 'script';
    project_id: number;
    permission_code: 'editor' | 'viewer' | 'none';
  }>;
  status: string;
  kind: string;
}

@Injectable()
export class TeamsService {
  /** 管理团队显示角色、注册用户邀请和加入申请。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  /** 所有团队成员可查询可选角色，管理员角色仅用于授权后的分配。 */
  async roles(actor: Identity): Promise<{ list: RoleRow[] }> {
    const result = await this.db.query<RoleRow>(
      `SELECT id AS role_id,role_name,system_role='custom' AS is_custom
       FROM account_roles WHERE account_id=$1 ORDER BY CASE system_role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,id`,
      [actor.accountId],
    );
    return { list: result.rows };
  }

  /** 创建仅用于显示和邀请分组的自定义成员角色。 */
  async createRole(actor: Identity, roleName: string): Promise<{ role_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO account_roles(account_id,role_name,system_role)
       SELECT id,$2,'custom' FROM accounts WHERE id=$1 AND type='team' AND dissolved_at IS NULL
       ON CONFLICT DO NOTHING RETURNING id`,
      [actor.accountId, roleName],
    );
    if (!result.rows[0]) throw new AppError(409, '角色已存在或团队不可用');
    return { role_id: result.rows[0].id };
  }

  /** 删除没有成员或待处理邀请引用的自定义角色。 */
  async deleteRole(actor: Identity, roleId: number): Promise<{ role_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    return this.db.transaction(async (client) => {
      const role = await client.query<{ system_role: string }>(
        'SELECT system_role FROM account_roles WHERE id=$1 AND account_id=$2 FOR UPDATE',
        [roleId, actor.accountId],
      );
      if (!role.rows[0]) throw new AppError(404, '角色不存在');
      if (role.rows[0].system_role !== 'custom') throw new AppError(403, '内置角色不可删除');
      const used = await client.query(
        `SELECT 1 FROM account_members WHERE role_id=$1 AND status='active'
         UNION ALL SELECT 1 FROM account_invitations WHERE role_id=$1 AND status='pending' LIMIT 1`,
        [roleId],
      );
      if (used.rowCount) throw new AppError(409, '角色仍被成员或邀请使用');
      await client.query('DELETE FROM account_roles WHERE id=$1', [roleId]);
      return { role_id: roleId };
    });
  }

  /** 向已注册手机号发出团队邀请，保存待接受的项目权限。 */
  async invite(actor: Identity, input: z.infer<typeof invite>): Promise<{ invite_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    return this.db.transaction(async (client) => {
      const account = await client.query(
        `SELECT 1 FROM accounts WHERE id=$1 AND type='team' AND dissolved_at IS NULL FOR SHARE`,
        [actor.accountId],
      );
      if (!account.rowCount) throw new AppError(404, '团队不存在');
      const user = await client.query<{ id: number }>('SELECT id FROM users WHERE mobile=$1', [
        input.mobile,
      ]);
      if (!user.rows[0]) throw new AppError(404, '手机号尚未注册');
      const targetId = user.rows[0].id;
      const membership = await client.query(
        `SELECT 1 FROM account_members WHERE account_id=$1 AND user_id=$2 AND status='active'`,
        [actor.accountId, targetId],
      );
      if (membership.rowCount) throw new AppError(409, '用户已是团队成员');
      const role = await client.query<{ system_role: string }>(
        'SELECT system_role FROM account_roles WHERE id=$1 AND account_id=$2',
        [input.role_id, actor.accountId],
      );
      if (!role.rows[0]) throw new AppError(404, '角色不存在');
      if (role.rows[0].system_role === 'admin' && actor.role !== 'owner')
        throw new AppError(403, '只有所有者可以邀请管理员');
      const keys = new Set<string>();
      for (const permission of input.permissions) {
        const key = `${permission.project_type}:${permission.project_id}`;
        if (keys.has(key)) throw new AppError(400, '项目权限不得重复');
        keys.add(key);
        await this.permissions.assertProject(
          actor,
          permission.project_type,
          permission.project_id,
          'read',
          client,
        );
      }
      const created = await client.query<{ id: number }>(
        `INSERT INTO account_invitations(account_id,target_user_id,inviter_user_id,role_id,permissions)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
        [actor.accountId, targetId, actor.userId, input.role_id, JSON.stringify(input.permissions)],
      );
      if (!created.rows[0]) throw new AppError(409, '已有待处理邀请');
      await client.query(
        `INSERT INTO notifications(type,account_id,recipient_user_id,sub_type,title,intro,ext_data)
         VALUES (2,$1,$2,1,'团队邀请','你收到一条团队邀请',$3)`,
        [actor.accountId, targetId, JSON.stringify({ invite_id: created.rows[0].id })],
      );
      return { invite_id: created.rows[0].id };
    });
  }

  /** 返回团队内等待管理员审核的加入申请。 */
  async applications(actor: Identity): Promise<{
    list: Array<{
      id: number;
      user_id: number;
      nickname: string;
      role_id: number;
      role_name: string;
      created_at: Date;
    }>;
  }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    const result = await this.db.query<{
      id: number;
      user_id: number;
      nickname: string;
      role_id: number;
      role_name: string;
      created_at: Date;
    }>(
      `SELECT i.id,i.target_user_id AS user_id,COALESCE(u.nickname,u.username) AS nickname,i.role_id,r.role_name,i.created_at
       FROM account_invitations i JOIN users u ON u.id=i.target_user_id
       JOIN account_roles r ON r.id=i.role_id
       WHERE i.account_id=$1 AND i.kind='application' AND i.status='pending' ORDER BY i.id DESC`,
      [actor.accountId],
    );
    return { list: result.rows };
  }

  /** 邀请接收者决定接受或拒绝；成员关系和权限必须在同一事务提交。 */
  async accept(
    actor: Identity,
    inviteId: number,
    accept: boolean,
  ): Promise<{ invite_id: number; accepted: boolean }> {
    return this.db.transaction(async (client) => {
      const invitation = await this.lockInvitation(client, inviteId, 'invitation');
      if (invitation.target_user_id !== actor.userId) throw new AppError(404, '邀请不存在');
      await this.resolveInvitation(client, invitation, accept);
      return { invite_id: inviteId, accepted: accept };
    });
  }

  /** 管理员审核申请，仅处理当前团队的申请记录。 */
  async review(
    actor: Identity,
    inviteId: number,
    accept: boolean,
  ): Promise<{ invite_id: number; accepted: boolean }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    return this.db.transaction(async (client) => {
      const invitation = await this.lockInvitation(client, inviteId, 'application');
      if (invitation.account_id !== actor.accountId) throw new AppError(404, '申请不存在');
      if (invitation.role_kind === 'admin' && actor.role !== 'owner')
        throw new AppError(403, '只有所有者可以批准管理员');
      await this.resolveInvitation(client, invitation, accept);
      return { invite_id: inviteId, accepted: accept };
    });
  }

  /** 锁定尚未处理且所属团队仍有效的邀请。 */
  private async lockInvitation(
    client: PoolClient,
    inviteId: number,
    kind: 'invitation' | 'application',
  ): Promise<InvitationRow> {
    const result = await client.query<InvitationRow>(
      `SELECT i.*,r.system_role AS role_kind FROM account_invitations i
       JOIN account_roles r ON r.id=i.role_id AND r.account_id=i.account_id
       JOIN accounts a ON a.id=i.account_id AND a.dissolved_at IS NULL
       WHERE i.id=$1 AND i.kind=$2 AND i.status='pending' FOR UPDATE OF i`,
      [inviteId, kind],
    );
    if (!result.rows[0]) throw new AppError(404, '邀请或申请不存在');
    return result.rows[0];
  }

  /** 完成邀请状态、成员关系和逐项目权限的原子变更。 */
  private async resolveInvitation(
    client: PoolClient,
    invitation: InvitationRow,
    accept: boolean,
  ): Promise<void> {
    if (accept) {
      const membership = await client.query<{ role: string; status: string }>(
        `SELECT role,status FROM account_members WHERE account_id=$1 AND user_id=$2 FOR UPDATE`,
        [invitation.account_id, invitation.target_user_id],
      );
      if (membership.rows[0]?.status === 'active') throw new AppError(409, '用户已是团队成员');
      const role = invitation.role_kind === 'admin' ? 'admin' : 'member';
      await client.query(
        `INSERT INTO account_members(account_id,user_id,role,role_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT (account_id,user_id) DO UPDATE SET
         role=EXCLUDED.role,role_id=EXCLUDED.role_id,status='active',updated_at=now()`,
        [invitation.account_id, invitation.target_user_id, role, invitation.role_id],
      );
      for (const permission of invitation.permissions) {
        const table = permission.project_type === 'drama' ? 'dramas' : 'scripts';
        const project = await client.query(
          `SELECT 1 FROM ${table} WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL`,
          [permission.project_id, invitation.account_id],
        );
        if (!project.rowCount) throw new AppError(409, '邀请中的项目已不可用');
        await client.query(
          `INSERT INTO project_permissions(account_id,project_type,project_id,user_id,permission_code)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id,project_type,project_id,user_id)
           DO UPDATE SET permission_code=EXCLUDED.permission_code,updated_at=now()`,
          [
            invitation.account_id,
            permission.project_type,
            permission.project_id,
            invitation.target_user_id,
            permission.permission_code,
          ],
        );
      }
    }
    await client.query(`UPDATE account_invitations SET status=$1,resolved_at=now() WHERE id=$2`, [
      accept ? 'accepted' : 'rejected',
      invitation.id,
    ]);
  }
}
