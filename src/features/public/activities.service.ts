import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';
import { OpusesService, type PublishOpus } from './opuses.service';
import type { z } from 'zod';
import type { activitySignup } from './activities.schemas';

@Injectable()
export class ActivitiesService {
  /** 公开活动目录与报名记录分离，报名按当前账号和用户隔离。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(OpusesService) private readonly opuses: OpusesService,
  ) {}

  /** 仅展示已发布活动。 */
  async list(page: number, limit: number): Promise<{ list: unknown[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT id AS activity_id,title,status,cover_image,award_credit_total,award_money_total
         FROM activities WHERE status BETWEEN 1 AND 4 ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM activities WHERE status BETWEEN 1 AND 4',
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 公开详情仅包含已发布活动，登录用户另可见自己的报名与投稿状态。 */
  async detail(id: number, actor?: Identity): Promise<unknown> {
    const result = await this.db.query(
      `SELECT a.id AS activity_id,a.title,a.status,a.award_credit_total,a.award_money_total,
       to_char(a.start_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS start_date,
       to_char(a.end_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS end_date,
       a.detail_content,a.head_image,a.detail_url,
       EXISTS(SELECT 1 FROM activity_signups s WHERE s.activity_id=a.id AND s.account_id=$2
              AND s.user_id=$3 AND NOT s.is_draft) AS signup_status,
       EXISTS(SELECT 1 FROM opuses o WHERE o.activity_id=a.id AND o.account_id=$2
              AND o.created_by=$3) AS submit_status
       FROM activities a WHERE a.id=$1 AND a.status BETWEEN 1 AND 4`,
      [id, actor?.accountId ?? null, actor?.userId ?? null],
    );
    if (!result.rows[0]) throw new AppError(404, '活动不存在');
    return result.rows[0];
  }

  /** 报名草稿可在活动开始前保存，正式报名须在活动期内完成。 */
  async signup(
    actor: Identity,
    input: z.infer<typeof activitySignup>,
  ): Promise<{ activity_id: number; is_draft: boolean }> {
    return this.db.transaction(async (client) => {
      const activity = await client.query<{ status: number; start_at: Date; end_at: Date }>(
        'SELECT status,start_at,end_at FROM activities WHERE id=$1 FOR SHARE',
        [input.activity_id],
      );
      if (!activity.rows[0] || ![1, 2].includes(activity.rows[0].status))
        throw new AppError(404, '可报名活动不存在');
      const account = await client.query<{ type: string }>(
        'SELECT type FROM accounts WHERE id=$1',
        [actor.accountId],
      );
      if (
        (input.entry_type === 1 && account.rows[0]?.type !== 'personal') ||
        (input.entry_type === 2 && account.rows[0]?.type !== 'team')
      )
        throw new AppError(400, '报名类型与当前账号不一致');
      if (input.entry_type === 2 && actor.role === 'member')
        throw new AppError(403, '团队报名需管理员提交');
      if (
        !input.is_draft &&
        (activity.rows[0].status !== 2 ||
          Date.now() < activity.rows[0].start_at.getTime() ||
          Date.now() > activity.rows[0].end_at.getTime())
      )
        throw new AppError(409, '当前不在活动报名时间内');
      if (input.is_draft && Date.now() > activity.rows[0].end_at.getTime())
        throw new AppError(409, '活动已结束');
      const existing = await client.query<{ is_draft: boolean }>(
        'SELECT is_draft FROM activity_signups WHERE activity_id=$1 AND account_id=$2 AND user_id=$3 FOR UPDATE',
        [input.activity_id, actor.accountId, actor.userId],
      );
      if (existing.rows[0] && !existing.rows[0].is_draft && input.is_draft)
        throw new AppError(409, '已提交的报名不能改回草稿');
      await client.query(
        `INSERT INTO activity_signups(activity_id,account_id,user_id,entry_type,contact_mobile,
         contact_email,true_name,speciality,opus,team_people,team_leader,is_draft)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (activity_id,account_id,user_id) DO UPDATE SET
         entry_type=EXCLUDED.entry_type,contact_mobile=EXCLUDED.contact_mobile,
         contact_email=EXCLUDED.contact_email,true_name=EXCLUDED.true_name,
         speciality=EXCLUDED.speciality,opus=EXCLUDED.opus,team_people=EXCLUDED.team_people,
         team_leader=EXCLUDED.team_leader,is_draft=EXCLUDED.is_draft,
         check_status=0,check_reject_reason=NULL,updated_at=now()`,
        [
          input.activity_id,
          actor.accountId,
          actor.userId,
          input.entry_type,
          input.contact_mobile,
          input.contact_email,
          input.true_name,
          JSON.stringify(input.speciality),
          JSON.stringify(input.opus),
          input.team_people ?? null,
          input.team_leader ?? null,
          input.is_draft,
        ],
      );
      return { activity_id: input.activity_id, is_draft: input.is_draft };
    });
  }

  /** 返回本账号当前用户的正式报名审核状态。 */
  async signupDetail(actor: Identity, activityId: number): Promise<unknown> {
    const result = await this.db.query(
      `SELECT check_status,check_reject_reason FROM activity_signups
       WHERE activity_id=$1 AND account_id=$2 AND user_id=$3 AND NOT is_draft`,
      [activityId, actor.accountId, actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '报名记录不存在');
    return result.rows[0];
  }

  /** 草稿不存在时返回 null，便于前端初次填写报名信息。 */
  async draft(actor: Identity, activityId: number): Promise<unknown> {
    const result = await this.db.query(
      `SELECT activity_id,entry_type,contact_mobile,contact_email,true_name,speciality,opus,
       team_people,team_leader FROM activity_signups
       WHERE activity_id=$1 AND account_id=$2 AND user_id=$3 AND is_draft`,
      [activityId, actor.accountId, actor.userId],
    );
    return result.rows[0] ?? null;
  }

  /** 返回当前用户已正式报名的活动选择项。 */
  async signedUp(actor: Identity): Promise<{ list: unknown[] }> {
    const result = await this.db.query(
      `SELECT a.id AS activity_id,a.title AS activity_title FROM activity_signups s
       JOIN activities a ON a.id=s.activity_id WHERE s.account_id=$1 AND s.user_id=$2
       AND NOT s.is_draft AND a.status BETWEEN 1 AND 4 ORDER BY a.id DESC`,
      [actor.accountId, actor.userId],
    );
    return { list: result.rows };
  }

  /** 活动投稿仍按作品发布规则执行同一项目、媒体与报名校验。 */
  async submitOpus(
    actor: Identity,
    input: PublishOpus & { activity_id: number },
  ): Promise<{ opus_id: number }> {
    return this.opuses.publish(actor, input);
  }
}
