import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';

interface Summary {
  output_type: string;
  count: number;
  cost: number;
  days: number;
}

@Injectable()
export class StatisticsService {
  /** 团队数据中心从已受理任务的积分成本计算，失败和取消任务不计入消耗。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 数据中心涉及成员手机号和全团队成本，仅团队管理员可见。 */
  private async assertManager(actor: Identity): Promise<void> {
    if (actor.role === 'member') throw new AppError(403, '没有数据中心权限');
    const team = await this.db.query(
      'SELECT 1 FROM accounts WHERE id=$1 AND type=$2 AND dissolved_at IS NULL',
      [actor.accountId, 'team'],
    );
    if (!team.rowCount) throw new AppError(400, '仅团队可查看数据中心');
  }

  /** 返回总成本和图片、文本、视频、音频产出概览。 */
  async panel(actor: Identity): Promise<unknown> {
    await this.assertManager(actor);
    const result = await this.db.query<Summary>(
      `SELECT COALESCE(payload->>'task_type','other') AS output_type,count(*)::int AS count,
       COALESCE(sum(price_credits),0)::int AS cost,
       count(DISTINCT (created_at AT TIME ZONE 'Asia/Shanghai')::date)::int AS days
       FROM generation_tasks WHERE account_id=$1 AND status IN ('queued','running','completed')
       GROUP BY payload->>'task_type'`,
      [actor.accountId],
    );
    const groups = new Map(result.rows.map((row) => [row.output_type, row]));
    const info = (type: string) => {
      const row = groups.get(type);
      return {
        count: row?.count ?? 0,
        cost: row?.cost ?? 0,
        avg_cost: row?.count ? row.cost / row.count : 0,
      };
    };
    const totalCost = result.rows.reduce((sum, row) => sum + row.cost, 0);
    const days = await this.db.query<{ days: number }>(
      `SELECT count(DISTINCT (created_at AT TIME ZONE 'Asia/Shanghai')::date)::int AS days
       FROM generation_tasks WHERE account_id=$1 AND status IN ('queued','running','completed')`,
      [actor.accountId],
    );
    const recordDays = days.rows[0].days;
    return {
      total_info: {
        total_cost: totalCost,
        days: recordDays,
        avg_daily_cost: recordDays ? totalCost / recordDays : 0,
      },
      image_info: info('image'),
      text_info: info('text'),
      video_info: info('video'),
      audio_info: info('audio'),
      output_info: {
        avg_daily_output: recordDays
          ? result.rows.reduce((sum, row) => sum + row.count, 0) / recordDays
          : 0,
        text_count: info('text').count,
        image_count: info('image').count,
        video_count: info('video').count,
      },
    };
  }

  /** 按项目汇总实际受理任务费用及产出。 */
  async projects(actor: Identity, page: number, limit: number): Promise<unknown> {
    await this.assertManager(actor);
    const [rows, totals] = await Promise.all([
      this.db.query(
        `SELECT d.id AS project_id,'drama' AS project_type,'短剧' AS project_type_text,
         d.title,'' AS description,d.cover_image,
         count(t.task_id) FILTER (WHERE t.payload->>'task_type'='image')::int AS image_count,
         count(t.task_id) FILTER (WHERE t.payload->>'task_type'='video')::int AS video_count,
         count(DISTINCT t.created_by)::int AS participant_count,
         COALESCE(sum(t.price_credits),0)::int AS total_cost
         FROM dramas d LEFT JOIN canvases c ON c.drama_id=d.id
         LEFT JOIN generation_tasks t ON t.canvas_id=c.id AND t.account_id=$1
           AND t.status IN ('queued','running','completed')
         WHERE d.account_id=$1 AND d.deleted_at IS NULL AND d.type<>'group'
         GROUP BY d.id ORDER BY total_cost DESC,d.id DESC LIMIT $2 OFFSET $3`,
        [actor.accountId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number; grand_total: number }>(
        `SELECT count(DISTINCT d.id)::int AS total,COALESCE(sum(t.price_credits),0)::int AS grand_total
         FROM dramas d LEFT JOIN canvases c ON c.drama_id=d.id
         LEFT JOIN generation_tasks t ON t.canvas_id=c.id AND t.account_id=$1
           AND t.status IN ('queued','running','completed')
         WHERE d.account_id=$1 AND d.deleted_at IS NULL AND d.type<>'group'`,
        [actor.accountId],
      ),
    ]);
    const grandTotal = totals.rows[0].grand_total;
    return {
      grand_total: grandTotal,
      total: totals.rows[0].total,
      list: rows.rows.map((row) => ({
        ...row,
        percentage: grandTotal ? (Number(row.total_cost) / grandTotal) * 100 : 0,
      })),
    };
  }

  /** 按当前团队有效成员汇总实际任务消耗。 */
  async members(actor: Identity, page: number, limit: number): Promise<unknown> {
    await this.assertManager(actor);
    const [rows, totals] = await Promise.all([
      this.db.query(
        `SELECT m.user_id,COALESCE(u.nickname,u.username) AS nickname,u.avatar,
         COALESCE(sum(t.price_credits),0)::int AS total_cost,
         count(t.task_id) FILTER (WHERE t.payload->>'task_type'='image')::int AS image_count,
         count(t.task_id) FILTER (WHERE t.payload->>'task_type'='video')::int AS video_count,
         count(DISTINCT c.drama_id)::int AS project_count
         FROM account_members m JOIN users u ON u.id=m.user_id
         LEFT JOIN generation_tasks t ON t.account_id=m.account_id AND t.created_by=m.user_id
           AND t.status IN ('queued','running','completed')
         LEFT JOIN canvases c ON c.id=t.canvas_id
         WHERE m.account_id=$1 AND m.status='active' GROUP BY m.user_id,u.id
         ORDER BY total_cost DESC,m.user_id LIMIT $2 OFFSET $3`,
        [actor.accountId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number; grand_total: number }>(
        `SELECT (SELECT count(*)::int FROM account_members WHERE account_id=$1 AND status='active') AS total,
         COALESCE(sum(price_credits),0)::int AS grand_total FROM generation_tasks
         WHERE account_id=$1 AND status IN ('queued','running','completed')`,
        [actor.accountId],
      ),
    ]);
    const grandTotal = totals.rows[0].grand_total;
    return {
      grand_total: grandTotal,
      total: totals.rows[0].total,
      list: rows.rows.map((row) => ({
        ...row,
        percentage: grandTotal ? (Number(row.total_cost) / grandTotal) * 100 : 0,
      })),
    };
  }

  /** 共享项目和成员明细字段，拒绝跨账号 ID。 */
  private async details(
    actor: Identity,
    condition: 'project' | 'member',
    id: number,
  ): Promise<{ list: unknown[]; total: number }> {
    const where = condition === 'project' ? 'd.id=$2' : 't.created_by=$2';
    const from = `FROM generation_tasks t JOIN canvases c ON c.id=t.canvas_id
       JOIN dramas d ON d.id=c.drama_id WHERE t.account_id=$1 AND d.account_id=$1
       AND t.status IN ('queued','running','completed') AND ${where}`;
    const [result, count] = await Promise.all([
      this.db.query(
        `SELECT d.title AS project_title,
       to_char(t.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
       (-t.price_credits)::text AS credit,'drama' AS project_type,
       COALESCE(t.payload->>'task_type','other') AS output_type,
       CASE WHEN (t.payload->'parameters'->>'duration') ~ '^[0-9]+$'
         THEN (t.payload->'parameters'->>'duration')::int ELSE 0 END AS video_second,
       COALESCE(t.payload->>'model_code','') AS "desc"
       ${from} ORDER BY t.created_at DESC,t.task_id DESC LIMIT 200`,
        [actor.accountId, id],
      ),
      this.db.query<{ total: number }>(`SELECT count(*)::int AS total ${from}`, [
        actor.accountId,
        id,
      ]),
    ]);
    return { list: result.rows, total: count.rows[0].total };
  }

  /** 项目消耗明细须先验证项目归属。 */
  async projectDetail(actor: Identity, id: number): Promise<unknown> {
    await this.assertManager(actor);
    const project = await this.db.query(
      'SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL',
      [id, actor.accountId],
    );
    if (!project.rowCount) throw new AppError(404, '项目不存在');
    return this.details(actor, 'project', id);
  }

  /** 成员消耗明细附带仅管理员可见的手机号与当前积分余额。 */
  async memberDetail(actor: Identity, id: number): Promise<unknown> {
    await this.assertManager(actor);
    const member = await this.db.query<{
      nickname: string;
      mobile: string | null;
      role_name: string;
    }>(
      `SELECT COALESCE(u.nickname,u.username) AS nickname,u.mobile,COALESCE(r.role_name,m.role) AS role_name
       FROM account_members m JOIN users u ON u.id=m.user_id
       LEFT JOIN account_roles r ON r.id=m.role_id
       WHERE m.account_id=$1 AND m.user_id=$2 AND m.status='active'`,
      [actor.accountId, id],
    );
    if (!member.rows[0]) throw new AppError(404, '成员不存在');
    const [details, wallet] = await Promise.all([
      this.details(actor, 'member', id),
      this.db.query<{ balance: number }>('SELECT balance FROM credit_wallets WHERE account_id=$1', [
        actor.accountId,
      ]),
    ]);
    return {
      ...member.rows[0],
      mobile: member.rows[0].mobile ?? '',
      remaining_balance: wallet.rows[0]?.balance ?? 0,
      ...details,
    };
  }
}
