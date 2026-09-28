import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';
import { AuthService } from '../auth';

interface UserInfoRow extends QueryResultRow {
  uuid: string;
  avatar: string | null;
  nickname: string;
  account_name: string;
  account_type: string;
  role_name: string;
  core_role: Identity['role'];
  vip_level: number;
  plan_title: string;
  plan_expire: string | null;
}

interface AccountSummaryRow extends QueryResultRow {
  account_id: number;
  account_name: string;
  account_type: string;
  role_name: Identity['role'];
}

@Injectable()
export class AccountsService {
  /** 注入数据库，读取当前用户及其可访问账号。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** 返回当前用户在所选账号下的首页身份信息。 */
  async info(identity: Identity): Promise<{
    account_id: number;
    account_name: string;
    account_type: string;
    avatar: string | null;
    nickname: string;
    is_vip: boolean;
    vip_level: number;
    plan_expire: string | null;
    plan_title: string;
    role_name: string;
    is_admin: boolean;
    uuid: string;
  }> {
    const result = await this.db.query<UserInfoRow>(
      `SELECT u.uuid,u.avatar,COALESCE(u.nickname,u.username) AS nickname,
       a.name AS account_name,a.type AS account_type,
       COALESCE(r.role_name,m.role) AS role_name,m.role AS core_role,
       CASE WHEN e.expires_at>now() THEN e.vip_level ELSE 0 END AS vip_level,
       CASE WHEN e.expires_at>now() THEN e.plan_title ELSE '' END AS plan_title,
       CASE WHEN e.expires_at>now() THEN to_char(e.expires_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') ELSE NULL END AS plan_expire
       FROM users u JOIN accounts a ON a.id=$2
       JOIN account_members m ON m.account_id=a.id AND m.user_id=u.id AND m.status='active'
       LEFT JOIN account_roles r ON r.id=m.role_id
       LEFT JOIN account_entitlements e ON e.account_id=a.id WHERE u.id=$1`,
      [identity.userId, identity.accountId],
    );
    const row = result.rows[0];
    return {
      account_id: identity.accountId,
      account_name: row.account_name,
      account_type: row.account_type,
      avatar: row.avatar,
      nickname: row.nickname,
      is_vip: row.vip_level > 0,
      vip_level: row.vip_level,
      plan_expire: row.plan_expire,
      plan_title: row.plan_title,
      role_name: row.role_name,
      is_admin: row.core_role !== 'member',
      uuid: row.uuid,
    };
  }

  /** 修改用户展示名和头像，上传头像必须是当前账号已登记的媒体。 */
  async updateProfile(
    actor: Identity,
    input: { nickname?: string; avatar?: string | null },
  ): Promise<{ nickname: string; avatar: string | null }> {
    return this.db.transaction(async (client) => {
      const current = await client.query<{ avatar: string | null }>(
        'SELECT avatar FROM users WHERE id=$1 FOR UPDATE',
        [actor.userId],
      );
      if (!current.rows[0]) throw new AppError(404, '用户不存在');
      if (input.avatar && input.avatar !== current.rows[0].avatar) {
        const asset = await client.query(
          'SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3',
          [actor.accountId, input.avatar, 'image/%'],
        );
        if (!asset.rowCount) throw new AppError(404, '头像媒体不存在');
      }
      const result = await client.query<{ nickname: string; avatar: string | null }>(
        `UPDATE users SET nickname=COALESCE($1,nickname),avatar=CASE WHEN $2::boolean THEN $3 ELSE avatar END,
         updated_at=now() WHERE id=$4 RETURNING COALESCE(nickname,username) AS nickname,avatar`,
        [input.nickname ?? null, input.avatar !== undefined, input.avatar ?? null, actor.userId],
      );
      return result.rows[0];
    });
  }

  /** 读取当前账号保存 AI 内容时的去水印开关。 */
  async watermark(actor: Identity): Promise<{ watermark: boolean }> {
    const result = await this.db.query<{ watermark: boolean }>(
      'SELECT watermark FROM accounts WHERE id=$1',
      [actor.accountId],
    );
    if (!result.rows[0]) throw new AppError(404, '账号不存在');
    return result.rows[0];
  }

  /** 去水印必须有有效权益，团队开关只能由管理员修改。 */
  async updateWatermark(actor: Identity, watermark: boolean): Promise<{ watermark: boolean }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    const result = await this.db.query<{ watermark: boolean }>(
      `UPDATE accounts a SET watermark=$1,updated_at=now() WHERE a.id=$2
       AND (NOT $1 OR EXISTS (SELECT 1 FROM account_entitlements e WHERE e.account_id=a.id
            AND e.remove_watermark AND e.expires_at>now())) RETURNING watermark`,
      [watermark, actor.accountId],
    );
    if (!result.rows[0]) throw new AppError(403, '当前账号没有有效去水印权益');
    return result.rows[0];
  }

  /** 列出用户仍有有效成员身份的账号。 */
  async list(identity: Identity): Promise<{ list: AccountSummaryRow[] }> {
    const result = await this.db.query<AccountSummaryRow>(
      `SELECT a.id AS account_id,a.name AS account_name,a.type AS account_type,m.role AS role_name
      FROM accounts a JOIN account_members m ON m.account_id=a.id
      WHERE m.user_id=$1 AND m.status='active' AND a.dissolved_at IS NULL ORDER BY a.id`,
      [identity.userId],
    );
    return { list: result.rows };
  }

  /** 为当前用户创建独立团队账号和积分钱包。 */
  async createTeam(
    actor: Identity,
    input: { name: string; intro: string },
  ): Promise<{ account_id: number }> {
    return this.db.transaction(async (client) => {
      const created = await client.query<{ id: number }>(
        `INSERT INTO accounts(type,name,intro,owner_user_id) VALUES ('team',$1,$2,$3) RETURNING id`,
        [input.name, input.intro, actor.userId],
      );
      const accountId = created.rows[0].id;
      await client.query('INSERT INTO account_members(account_id,user_id,role) VALUES ($1,$2,$3)', [
        accountId,
        actor.userId,
        'owner',
      ]);
      await client.query(
        `INSERT INTO account_roles(account_id,role_name,system_role)
         VALUES ($1,'管理员','admin'),($1,'成员','member')`,
        [accountId],
      );
      await client.query('INSERT INTO credit_wallets(account_id) VALUES ($1)', [accountId]);
      return { account_id: accountId };
    });
  }

  /** 读取当前团队详情，仅允许当前账号查看。 */
  async team(
    actor: Identity,
    accountId: number,
  ): Promise<{
    account_id: number;
    account_name: string;
    name: string;
    intro: string;
    member_count: number;
  }> {
    if (actor.accountId !== accountId) throw new AppError(404, '团队不存在');
    const result = await this.db.query<{
      id: number;
      name: string;
      intro: string;
      member_count: number;
    }>(
      `SELECT a.id,a.name,a.intro,count(m.user_id)::int AS member_count FROM accounts a
       LEFT JOIN account_members m ON m.account_id=a.id AND m.status='active'
       WHERE a.id=$1 AND a.type='team' AND a.dissolved_at IS NULL GROUP BY a.id`,
      [accountId],
    );
    const team = result.rows[0];
    if (!team) throw new AppError(404, '团队不存在');
    return {
      account_id: team.id,
      account_name: team.name,
      name: team.name,
      intro: team.intro,
      member_count: team.member_count,
    };
  }

  /** 所有者或管理员修改当前团队名称及简介。 */
  async updateTeam(
    actor: Identity,
    accountId: number,
    input: { name?: string; intro?: string },
  ): Promise<{ account_id: number; account_name: string; intro: string }> {
    if (actor.accountId !== accountId) throw new AppError(404, '团队不存在');
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    const result = await this.db.query<{ name: string; intro: string }>(
      `UPDATE accounts SET name=COALESCE($1,name),intro=COALESCE($2,intro),updated_at=now()
       WHERE id=$3 AND type='team' AND dissolved_at IS NULL RETURNING name,intro`,
      [input.name ?? null, input.intro ?? null, accountId],
    );
    if (!result.rows[0]) throw new AppError(404, '团队不存在');
    return {
      account_id: accountId,
      account_name: result.rows[0].name,
      intro: result.rows[0].intro,
    };
  }

  /** 列出当前团队成员与基础额度展示字段。 */
  async members(actor: Identity): Promise<{
    list: Array<{
      user_id: number;
      nickname: string;
      avatar: string | null;
      role_name: string;
      is_admin: boolean;
      use_credit: number;
      credit_quota: number;
      join_time: string;
    }>;
  }> {
    const result = await this.db.query<{
      user_id: number;
      nickname: string;
      avatar: string | null;
      role_name: string;
      core_role: string;
      join_time: string;
      credit_quota: number;
    }>(
      `SELECT m.user_id,COALESCE(u.nickname,u.username) AS nickname,u.avatar,COALESCE(r.role_name,m.role) AS role_name,
       m.role AS core_role,
       COALESCE(q.credit_quota,-1)::float8 AS credit_quota,
       to_char(m.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS join_time
       FROM account_members m JOIN users u ON u.id=m.user_id
       LEFT JOIN account_roles r ON r.id=m.role_id
       LEFT JOIN member_credit_allocations q ON q.account_id=m.account_id AND q.user_id=m.user_id
       WHERE m.account_id=$1 AND m.status='active' ORDER BY m.created_at,m.user_id`,
      [actor.accountId],
    );
    const usage = await this.db.query<{ created_by: number; use_credit: number }>(
      `SELECT created_by,sum(price_credits)::int AS use_credit FROM generation_tasks
       WHERE account_id=$1 AND created_by IS NOT NULL AND status IN ('queued','running','completed')
       AND created_at>=date_trunc('month',now()) GROUP BY created_by`,
      [actor.accountId],
    );
    const usageByUser = new Map(usage.rows.map((row) => [row.created_by, row.use_credit]));
    // 未配置额度时 -1 表示不限额；已配置成员的使用量以当月已受理任务为准。
    return {
      list: result.rows.map((row) => ({
        user_id: row.user_id,
        nickname: row.nickname,
        avatar: row.avatar,
        role_name: row.role_name,
        join_time: row.join_time,
        is_admin: row.core_role !== 'member',
        use_credit: usageByUser.get(row.user_id) ?? 0,
        credit_quota: row.credit_quota,
      })),
    };
  }

  /** 返回用于团队成员选择器的用户基础资料。 */
  async memberSelect(
    actor: Identity,
  ): Promise<{ list: Array<{ user_id: number; nickname: string; avatar: string | null }> }> {
    const members = await this.members(actor);
    return {
      list: members.list.map(({ user_id, nickname, avatar }) => ({ user_id, nickname, avatar })),
    };
  }

  /** 移除团队成员并在同一事务中撤销其团队会话。 */
  async removeMember(actor: Identity, targetUserId: number): Promise<{ user_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    const sessions = await this.db.transaction(async (client) => {
      const actorRole = await client.query<{ role: string }>(
        `SELECT role FROM account_members WHERE account_id=$1 AND user_id=$2 AND status='active' FOR UPDATE`,
        [actor.accountId, actor.userId],
      );
      const target = await client.query<{ role: string }>(
        `SELECT role FROM account_members WHERE account_id=$1 AND user_id=$2 AND status='active' FOR UPDATE`,
        [actor.accountId, targetUserId],
      );
      if (!target.rows[0]) throw new AppError(404, '成员不存在');
      if (!actorRole.rows[0] || actorRole.rows[0].role === 'member')
        throw new AppError(403, '没有管理权限');
      if (
        target.rows[0].role === 'owner' ||
        (target.rows[0].role === 'admin' && actorRole.rows[0].role !== 'owner')
      )
        throw new AppError(403, '没有移除该成员的权限');
      await client.query(
        `UPDATE account_members SET status='removed',updated_at=now() WHERE account_id=$1 AND user_id=$2`,
        [actor.accountId, targetUserId],
      );
      await client.query('DELETE FROM project_permissions WHERE account_id=$1 AND user_id=$2', [
        actor.accountId,
        targetUserId,
      ]);
      await client.query(
        'DELETE FROM member_credit_allocations WHERE account_id=$1 AND user_id=$2',
        [actor.accountId, targetUserId],
      );
      const revoked = await client.query<{ id: string }>(
        `UPDATE refresh_sessions SET revoked_at=now(),updated_at=now()
         WHERE account_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,
        [actor.accountId, targetUserId],
      );
      return revoked.rows.map((row) => row.id);
    });
    await this.auth.invalidateSessions(sessions);
    return { user_id: targetUserId };
  }

  /** 将管理员身份转给普通成员并立即让后续请求读取新角色。 */
  async transferAdmin(actor: Identity, targetUserId: number): Promise<{ user_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    await this.db.transaction(async (client) => {
      const members = await client.query<{ user_id: number; role: string }>(
        `SELECT user_id,role FROM account_members WHERE account_id=$1 AND user_id=ANY($2::int[])
         AND status='active' ORDER BY user_id FOR UPDATE`,
        [actor.accountId, [actor.userId, targetUserId]],
      );
      const own = members.rows.find((row) => row.user_id === actor.userId);
      const target = members.rows.find((row) => row.user_id === targetUserId);
      if (!own || !target || own.role === 'member' || target.role !== 'member')
        throw new AppError(403, '无法转移管理员权限');
      await client.query(
        `UPDATE account_members SET role='admin',role_id=(SELECT id FROM account_roles WHERE account_id=$1 AND system_role='admin'),updated_at=now() WHERE account_id=$1 AND user_id=$2`,
        [actor.accountId, targetUserId],
      );
      if (own.role === 'admin')
        await client.query(
          `UPDATE account_members SET role='member',role_id=(SELECT id FROM account_roles WHERE account_id=$1 AND system_role='member'),updated_at=now() WHERE account_id=$1 AND user_id=$2`,
          [actor.accountId, actor.userId],
        );
    });
    return { user_id: targetUserId };
  }

  /** 普通成员或管理员退出团队，撤销其旧团队会话。 */
  async quitTeam(actor: Identity): Promise<{ account_id: number }> {
    if (actor.role === 'owner') throw new AppError(409, '团队所有者不能退出');
    const sessions = await this.db.transaction(async (client) => {
      const membership = await client.query<{ role: string }>(
        `SELECT m.role FROM account_members m JOIN accounts a ON a.id=m.account_id
         WHERE m.account_id=$1 AND m.user_id=$2 AND m.status='active' AND a.type='team'
         AND a.dissolved_at IS NULL FOR UPDATE OF m`,
        [actor.accountId, actor.userId],
      );
      if (!membership.rows[0]) throw new AppError(404, '团队不存在');
      if (membership.rows[0].role === 'owner') throw new AppError(409, '团队所有者不能退出');
      await client.query(
        `UPDATE account_members SET status='removed',updated_at=now() WHERE account_id=$1 AND user_id=$2`,
        [actor.accountId, actor.userId],
      );
      await client.query('DELETE FROM project_permissions WHERE account_id=$1 AND user_id=$2', [
        actor.accountId,
        actor.userId,
      ]);
      await client.query(
        'DELETE FROM member_credit_allocations WHERE account_id=$1 AND user_id=$2',
        [actor.accountId, actor.userId],
      );
      const revoked = await client.query<{ id: string }>(
        `UPDATE refresh_sessions SET revoked_at=now(),updated_at=now()
         WHERE account_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,
        [actor.accountId, actor.userId],
      );
      return revoked.rows.map((row) => row.id);
    });
    await this.auth.invalidateSessions(sessions);
    return { account_id: actor.accountId };
  }

  /** 所有者解散团队并撤销所有成员的团队会话，保留账务数据以供审计。 */
  async dissolveTeam(actor: Identity): Promise<{ account_id: number }> {
    if (actor.role !== 'owner') throw new AppError(403, '只有所有者可以解散团队');
    const sessions = await this.db.transaction(async (client) => {
      const team = await client.query(
        `SELECT 1 FROM accounts WHERE id=$1 AND type='team' AND owner_user_id=$2
         AND dissolved_at IS NULL FOR UPDATE`,
        [actor.accountId, actor.userId],
      );
      if (!team.rowCount) throw new AppError(404, '团队不存在');
      const activeTasks = await client.query(
        `SELECT 1 FROM generation_tasks WHERE account_id=$1 AND status IN ('queued','running') LIMIT 1`,
        [actor.accountId],
      );
      if (activeTasks.rowCount) throw new AppError(409, '团队仍有运行中的任务');
      await client.query('UPDATE accounts SET dissolved_at=now(),updated_at=now() WHERE id=$1', [
        actor.accountId,
      ]);
      await client.query(
        `UPDATE account_members SET status='removed',updated_at=now() WHERE account_id=$1`,
        [actor.accountId],
      );
      const revoked = await client.query<{ id: string }>(
        `UPDATE refresh_sessions SET revoked_at=now(),updated_at=now()
         WHERE account_id=$1 AND revoked_at IS NULL RETURNING id`,
        [actor.accountId],
      );
      return revoked.rows.map((row) => row.id);
    });
    await this.auth.invalidateSessions(sessions);
    return { account_id: actor.accountId };
  }
}
