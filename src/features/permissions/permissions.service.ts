import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { QueryResultRow } from 'pg';
import { AppError } from '../../common';
import { Database, type QueryExecutor } from '../../database';
import { APP_CONFIG, type AppConfig } from '../../config';
import type { Identity } from '../auth';

export type ProjectType = 'drama' | 'script';
export type ProjectPermissionCode = 'owner' | 'editor' | 'viewer' | 'none';
export type ProjectAction = 'read' | 'edit' | 'generate' | 'delete';

interface ProjectMemberRow extends QueryResultRow {
  user_id: number;
  nickname: string;
  avatar: string | null;
  role: Identity['role'];
  role_name: string;
  permission_code: Exclude<ProjectPermissionCode, 'owner'> | null;
}

const PERMISSION_OPTIONS = [
  { label: '可编辑', value: 'editor' },
  { label: '仅查看', value: 'viewer' },
  { label: '无权限', value: 'none' },
] as const;

@Injectable()
export class PermissionsService implements OnModuleDestroy {
  private readonly events: Redis;
  /** 集中判定团队项目权限；显式权限立即覆盖成员的默认编辑权限。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.events = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  }

  /** 释放跨实例权限通知连接。 */
  onModuleDestroy(): void {
    this.events.disconnect();
  }

  /** 校验项目属于当前账号且未删除，并返回当前成员的有效权限。 */
  async projectCode(
    actor: Identity,
    projectType: ProjectType,
    projectId: number,
    query: QueryExecutor = this.db,
  ): Promise<ProjectPermissionCode> {
    const table = projectType === 'drama' ? 'dramas' : 'scripts';
    const project = await query.query(
      `SELECT 1 FROM ${table} WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL`,
      [projectId, actor.accountId],
    );
    if (!project.rowCount) throw new AppError(404, '项目不存在');
    if (actor.role !== 'member') return 'owner';
    const permission = await query.query<{ permission_code: ProjectPermissionCode }>(
      `SELECT permission_code FROM project_permissions
       WHERE account_id=$1 AND project_type=$2 AND project_id=$3 AND user_id=$4`,
      [actor.accountId, projectType, projectId, actor.userId],
    );
    return permission.rows[0]?.permission_code ?? 'editor';
  }

  /** 对项目读取、编辑、生成和删除执行统一授权。 */
  async assertProject(
    actor: Identity,
    projectType: ProjectType,
    projectId: number,
    action: ProjectAction,
    query: QueryExecutor = this.db,
  ): Promise<void> {
    const code = await this.projectCode(actor, projectType, projectId, query);
    if (code === 'none') throw new AppError(404, '项目不存在');
    if (action === 'delete' && actor.role === 'member') throw new AppError(403, '没有删除权限');
    if (action !== 'read' && code === 'viewer') throw new AppError(403, '没有编辑权限');
  }

  /** 团队创建权限默认沿用现有成员可创建行为。 */
  async assertCanCreate(actor: Identity, query: QueryExecutor = this.db): Promise<void> {
    if (actor.role !== 'member') return;
    const settings = await query.query<{ can_create: boolean }>(
      'SELECT can_create FROM account_permission_settings WHERE account_id=$1',
      [actor.accountId],
    );
    if (settings.rows[0]?.can_create === false) throw new AppError(403, '没有创建权限');
  }

  /** 返回当前团队的全局创建与资产共享配置。 */
  async global(actor: Identity): Promise<{ can_create: boolean; assets_share: boolean }> {
    const settings = await this.db.query<{ can_create: boolean; assets_share: boolean }>(
      'SELECT can_create,assets_share FROM account_permission_settings WHERE account_id=$1',
      [actor.accountId],
    );
    return settings.rows[0] ?? { can_create: true, assets_share: false };
  }

  /** 仅所有者和管理员可修改团队全局权限。 */
  async saveGlobal(
    actor: Identity,
    input: { can_create: boolean; assets_share: boolean },
  ): Promise<{ can_create: boolean; assets_share: boolean }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    const account = await this.db.query<{ type: string }>('SELECT type FROM accounts WHERE id=$1', [
      actor.accountId,
    ]);
    if (account.rows[0]?.type !== 'team') throw new AppError(400, '仅团队可设置权限');
    await this.db.query(
      `INSERT INTO account_permission_settings(account_id,can_create,assets_share)
       VALUES ($1,$2,$3) ON CONFLICT (account_id) DO UPDATE SET
       can_create=EXCLUDED.can_create,assets_share=EXCLUDED.assets_share,updated_at=now()`,
      [actor.accountId, input.can_create, input.assets_share],
    );
    return input;
  }

  /** 列出项目成员及其有效权限，管理员与所有者的权限不可被降级。 */
  async projectMembers(
    actor: Identity,
    projectType: ProjectType,
    projectId: number,
  ): Promise<{
    list: Array<{
      user_id: number;
      nickname: string;
      avatar: string | null;
      is_admin: boolean;
      role_name: string;
      permission_code: ProjectPermissionCode;
      options: typeof PERMISSION_OPTIONS | [];
    }>;
  }> {
    await this.assertProject(actor, projectType, projectId, 'read');
    const members = await this.db.query<ProjectMemberRow>(
      `SELECT m.user_id,COALESCE(u.nickname,u.username) AS nickname,u.avatar,m.role,
       COALESCE(r.role_name,m.role) AS role_name,p.permission_code
       FROM account_members m JOIN users u ON u.id=m.user_id
       LEFT JOIN account_roles r ON r.id=m.role_id
       LEFT JOIN project_permissions p ON p.account_id=m.account_id
         AND p.project_type=$2 AND p.project_id=$3 AND p.user_id=m.user_id
       WHERE m.account_id=$1 AND m.status='active' ORDER BY m.user_id`,
      [actor.accountId, projectType, projectId],
    );
    return {
      list: members.rows.map((row) => ({
        user_id: row.user_id,
        nickname: row.nickname,
        avatar: row.avatar,
        is_admin: row.role !== 'member',
        role_name: row.role_name,
        permission_code: row.role === 'member' ? (row.permission_code ?? 'editor') : 'owner',
        options: row.role === 'member' ? PERMISSION_OPTIONS : [],
      })),
    };
  }

  /** 原子保存团队开关和指定项目的成员权限，拒绝越权修改管理员。 */
  async saveProject(
    actor: Identity,
    input: {
      can_create: boolean;
      assets_share: boolean;
      project_type?: ProjectType;
      project_id?: number;
      list: Array<{ user_id: number; permission_code: 'editor' | 'viewer' | 'none' }>;
    },
  ): Promise<{ saved: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有管理权限');
    if ((input.project_id === undefined) !== (input.project_type === undefined))
      throw new AppError(400, 'project_type 和 project_id 必须同时提供');
    if (!input.project_type && input.list.length) throw new AppError(400, '缺少项目');
    const userIds = input.list.map((item) => item.user_id);
    if (new Set(userIds).size !== userIds.length) throw new AppError(400, '成员 ID 不得重复');
    const result = await this.db.transaction(async (client) => {
      const account = await client.query<{ type: string }>(
        'SELECT type FROM accounts WHERE id=$1 FOR SHARE',
        [actor.accountId],
      );
      if (account.rows[0]?.type !== 'team') throw new AppError(400, '仅团队可设置权限');
      if (input.project_type && input.project_id)
        await this.assertProject(actor, input.project_type, input.project_id, 'read', client);
      if (userIds.length) {
        const members = await client.query<{ user_id: number; role: string }>(
          `SELECT user_id,role FROM account_members
           WHERE account_id=$1 AND user_id=ANY($2::int[]) AND status='active' FOR UPDATE`,
          [actor.accountId, userIds],
        );
        if (
          members.rows.length !== userIds.length ||
          members.rows.some((row) => row.role !== 'member')
        )
          throw new AppError(400, '只能设置当前团队普通成员的权限');
      }
      await client.query(
        `INSERT INTO account_permission_settings(account_id,can_create,assets_share)
         VALUES ($1,$2,$3) ON CONFLICT (account_id) DO UPDATE SET
         can_create=EXCLUDED.can_create,assets_share=EXCLUDED.assets_share,updated_at=now()`,
        [actor.accountId, input.can_create, input.assets_share],
      );
      for (const item of input.list) {
        await client.query(
          `INSERT INTO project_permissions(account_id,project_type,project_id,user_id,permission_code)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id,project_type,project_id,user_id)
           DO UPDATE SET permission_code=EXCLUDED.permission_code,updated_at=now()`,
          [
            actor.accountId,
            input.project_type,
            input.project_id,
            item.user_id,
            item.permission_code,
          ],
        );
      }
      return { saved: input.list.length };
    });
    if (input.project_type && input.project_id && input.list.length)
      await this.events.publish(
        'project-permissions',
        JSON.stringify({
          account_id: actor.accountId,
          project_type: input.project_type,
          project_id: input.project_id,
          user_ids: userIds,
        }),
      );
    return result;
  }
}
