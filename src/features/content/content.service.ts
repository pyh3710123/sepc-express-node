import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';

@Injectable()
export class ContentService {
  /** 公开文章和按账号/用户分发的通知使用独立可见范围。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 按业务 code 返回已发布且生效的文章。 */
  async article(code: string): Promise<unknown> {
    const result = await this.db.query(
      `SELECT id,code,title,content,
       to_char(updated_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS update_time,
       to_char(effective_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS effective_time,
       to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time
       FROM articles WHERE code=$1 AND published AND (effective_at IS NULL OR effective_at<=now())`,
      [code],
    );
    if (!result.rows[0]) throw new AppError(404, '文章不存在');
    return result.rows[0];
  }

  /** 按官方或团队范围分页列出可见通知，未读状态按用户计算。 */
  async notifications(
    actor: Identity,
    input: { page: number; limit: number; type: 1 | 2; unread?: boolean },
  ): Promise<unknown> {
    const filter = `n.type=$3 AND (n.type=1 OR
      (n.account_id=$2 AND (n.recipient_user_id IS NULL OR n.recipient_user_id=$1)) OR
      (n.recipient_user_id=$1 AND n.sub_type=1))`;
    const readFilter = `${filter} AND (NOT $4::boolean OR r.notification_id IS NULL)`;
    const params = [
      actor.userId,
      actor.accountId,
      input.type,
      input.unread === true,
      input.limit,
      (input.page - 1) * input.limit,
    ];
    const [rows, count, unread, join] = await Promise.all([
      this.db.query(
        `SELECT n.id AS notification_id,n.type,n.title,n.sub_type,n.intro,n.content,n.ext_data,
         to_char(n.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
         r.notification_id IS NOT NULL AS is_read,i.status AS invite_status
         FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1
         LEFT JOIN account_invitations i ON i.id=CASE WHEN (n.ext_data->>'invite_id') ~ '^[0-9]+$' THEN (n.ext_data->>'invite_id')::int ELSE NULL END
         WHERE ${readFilter} ORDER BY n.id DESC LIMIT $5 OFFSET $6`,
        params,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 WHERE ${readFilter}`,
        params.slice(0, 4),
      ),
      this.db.query(
        `SELECT 1 FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1
         WHERE (n.type=1 OR (n.account_id=$2 AND (n.recipient_user_id IS NULL OR n.recipient_user_id=$1))
         OR (n.recipient_user_id=$1 AND n.sub_type=1)) AND r.notification_id IS NULL LIMIT 1`,
        [actor.userId, actor.accountId],
      ),
      actor.role === 'member'
        ? Promise.resolve({ rowCount: 0 })
        : this.db.query(
            `SELECT 1 FROM account_invitations WHERE account_id=$1 AND kind='application' AND status='pending' LIMIT 1`,
            [actor.accountId],
          ),
    ]);
    return {
      list: rows.rows,
      total: count.rows[0].total,
      has_unread: Boolean(unread.rowCount),
      has_join_apply: Boolean(join.rowCount),
    };
  }

  /** 在确认通知对当前用户可见后标记已读并返回正文。 */
  async notification(actor: Identity, id: number): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const result = await client.query(
        `SELECT n.id AS notification_id,n.type,n.title,n.sub_type,n.intro,n.content,n.ext_data,
         to_char(n.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
         i.status AS invite_status
         FROM notifications n
         LEFT JOIN account_invitations i ON i.id=CASE WHEN (n.ext_data->>'invite_id') ~ '^[0-9]+$' THEN (n.ext_data->>'invite_id')::int ELSE NULL END
         WHERE n.id=$1 AND (n.type=1 OR
           (n.account_id=$2 AND (n.recipient_user_id IS NULL OR n.recipient_user_id=$3)) OR
           (n.recipient_user_id=$3 AND n.sub_type=1))`,
        [id, actor.accountId, actor.userId],
      );
      if (!result.rows[0]) throw new AppError(404, '通知不存在');
      await client.query(
        'INSERT INTO notification_reads(notification_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, actor.userId],
      );
      return { ...result.rows[0], is_read: true };
    });
  }
}
