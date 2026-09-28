import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database, type QueryExecutor } from '../../database';
import type { Identity } from '../auth';
import { PermissionsService } from '../permissions/permissions.service';
import { ProjectsService } from '../projects/projects.service';

/** 前端作品发布和活动投稿共用请求字段。 */
export interface PublishOpus {
  opus_id?: number;
  drama_id: number;
  canvas_id: number;
  opus_name: string;
  type_id: number;
  describe: string;
  cover_image: string;
  opus_video: string;
  allow_clone?: boolean;
  activity_id?: number;
}

@Injectable()
export class OpusesService {
  /** 公开作品读取只使用已发布记录；写入需在事务中核对项目和媒体归属。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  /** 查询并锁定当前账号的媒体登记，拒绝直接提交任意外部 URL。 */
  private async asset(
    query: QueryExecutor,
    actor: Identity,
    url: string,
    mime: 'image' | 'video',
  ): Promise<number> {
    const result = await query.query<{ id: number }>(
      'SELECT id FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3 ORDER BY id LIMIT 1 FOR SHARE',
      [actor.accountId, url, `${mime}/%`],
    );
    if (!result.rows[0]) throw new AppError(404, `${mime} 媒体资产不存在`);
    return result.rows[0].id;
  }

  /** 发布或编辑作品，账号、画布和封面/视频归属全部通过后立即公开。 */
  async publish(actor: Identity, input: PublishOpus): Promise<{ opus_id: number }> {
    return this.db.transaction(async (client) => {
      await this.permissions.assertProject(actor, 'drama', input.drama_id, 'edit', client);
      const canvas = await client.query(
        `SELECT 1 FROM canvases WHERE id=$1 AND account_id=$2 AND drama_id=$3 FOR SHARE`,
        [input.canvas_id, actor.accountId, input.drama_id],
      );
      if (!canvas.rowCount) throw new AppError(404, '画布不存在');
      const type = await client.query('SELECT 1 FROM opus_types WHERE id=$1 AND active', [
        input.type_id,
      ]);
      if (!type.rowCount) throw new AppError(400, '作品类型不可用');
      const coverId = await this.asset(client, actor, input.cover_image, 'image');
      const videoId = await this.asset(client, actor, input.opus_video, 'video');
      if (input.activity_id) {
        const signup = await client.query(
          `SELECT 1 FROM activity_signups s JOIN activities a ON a.id=s.activity_id
           WHERE s.activity_id=$1 AND s.account_id=$2 AND s.user_id=$3 AND NOT s.is_draft
           AND a.status=2 AND now() BETWEEN a.start_at AND a.end_at`,
          [input.activity_id, actor.accountId, actor.userId],
        );
        if (!signup.rowCount) throw new AppError(403, '活动尚未报名或已结束');
      }
      if (input.opus_id) {
        const existing = await client.query<{ created_by: number }>(
          'SELECT created_by FROM opuses WHERE id=$1 AND account_id=$2 FOR UPDATE',
          [input.opus_id, actor.accountId],
        );
        if (!existing.rows[0]) throw new AppError(404, '作品不存在');
        if (actor.role === 'member' && existing.rows[0].created_by !== actor.userId)
          throw new AppError(403, '不能编辑其他成员作品');
        await client.query(
          `UPDATE opuses SET drama_id=$1,canvas_id=$2,opus_name=$3,type_id=$4,description=$5,
           cover_asset_id=$6,video_asset_id=$7,allow_clone=$8,activity_id=$9,updated_at=now()
           WHERE id=$10`,
          [
            input.drama_id,
            input.canvas_id,
            input.opus_name,
            input.type_id,
            input.describe,
            coverId,
            videoId,
            input.allow_clone ?? false,
            input.activity_id ?? null,
            input.opus_id,
          ],
        );
        return { opus_id: input.opus_id };
      }
      const created = await client.query<{ id: number }>(
        `INSERT INTO opuses(account_id,created_by,drama_id,canvas_id,opus_name,type_id,description,
         cover_asset_id,video_asset_id,allow_clone,activity_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (activity_id,account_id,created_by) WHERE activity_id IS NOT NULL
         DO UPDATE SET drama_id=EXCLUDED.drama_id,canvas_id=EXCLUDED.canvas_id,
           opus_name=EXCLUDED.opus_name,type_id=EXCLUDED.type_id,description=EXCLUDED.description,
           cover_asset_id=EXCLUDED.cover_asset_id,video_asset_id=EXCLUDED.video_asset_id,
           allow_clone=EXCLUDED.allow_clone,updated_at=now()
         RETURNING id`,
        [
          actor.accountId,
          actor.userId,
          input.drama_id,
          input.canvas_id,
          input.opus_name,
          input.type_id,
          input.describe,
          coverId,
          videoId,
          input.allow_clone ?? false,
          input.activity_id ?? null,
        ],
      );
      return { opus_id: created.rows[0].id };
    });
  }

  /** 作品分类来源于数据库可用分类。 */
  async types(): Promise<{ list: unknown[] }> {
    const result = await this.db.query(
      'SELECT id AS type_id,name AS type_name FROM opus_types WHERE active ORDER BY id',
    );
    return { list: result.rows };
  }

  /** 当前账号的本人作品分页列表。 */
  async mine(
    actor: Identity,
    page: number,
    limit: number,
    isActivity?: 0 | 1,
  ): Promise<{ list: unknown[]; total: number }> {
    const params = [actor.accountId, actor.userId, isActivity ?? null, limit, (page - 1) * limit];
    const filter = `o.account_id=$1 AND (o.created_by=$2 OR $6::boolean)
      AND ($3::int IS NULL OR (o.activity_id IS NOT NULL)=($3=1))`;
    const values = [...params, actor.role !== 'member'];
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT o.id AS opus_id,o.opus_name,cover.url AS cover_image,
         to_char(o.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
         CASE WHEN o.award_rank IS NOT NULL THEN 1 WHEN a.status IN (2,3) THEN 2 ELSE 0 END AS activity_status
         FROM opuses o JOIN media_assets cover ON cover.id=o.cover_asset_id
         LEFT JOIN activities a ON a.id=o.activity_id WHERE ${filter}
         ORDER BY o.id DESC LIMIT $4 OFFSET $5`,
        values,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM opuses o WHERE ${filter}`,
        [actor.accountId, actor.userId, isActivity ?? null, null, null, actor.role !== 'member'],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 编辑弹窗仅能读取本账号本人或管理员的作品详情。 */
  async ownDetail(actor: Identity, opusId: number): Promise<unknown> {
    const result = await this.db.query(
      `SELECT o.id AS opus_id,o.drama_id,o.canvas_id,o.opus_name,o.type_id,o.description AS describe,
       cover.url AS cover_image,video.url AS opus_video,o.allow_clone,o.activity_id,
       d.title AS drama_title,d.cover_image AS drama_cover,
       to_char(d.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS drama_create_time
       FROM opuses o JOIN dramas d ON d.id=o.drama_id
       JOIN media_assets cover ON cover.id=o.cover_asset_id
       JOIN media_assets video ON video.id=o.video_asset_id
       WHERE o.id=$1 AND o.account_id=$2 AND (o.created_by=$3 OR $4::boolean)`,
      [opusId, actor.accountId, actor.userId, actor.role !== 'member'],
    );
    if (!result.rows[0]) throw new AppError(404, '作品不存在');
    await this.permissions.assertProject(actor, 'drama', result.rows[0].drama_id, 'read');
    return result.rows[0];
  }

  /** 删除作品要求当前账号所有者或管理员，保留源项目和媒体。 */
  async delete(actor: Identity, opusId: number): Promise<{ opus_id: number }> {
    if (actor.role === 'member') throw new AppError(403, '没有删除权限');
    const result = await this.db.query(
      'DELETE FROM opuses WHERE id=$1 AND account_id=$2 RETURNING id',
      [opusId, actor.accountId],
    );
    if (!result.rows[0]) throw new AppError(404, '作品不存在');
    return { opus_id: opusId };
  }

  /** 推荐列表只读取公开作品，不暴露账号内部项目 ID。 */
  async recommended(
    page: number,
    limit: number,
    typeId?: number,
    name?: string,
    activityId?: number,
  ): Promise<{ list: unknown[]; total: number }> {
    const filter = `o.published_at IS NOT NULL AND ($1::int IS NULL OR o.type_id=$1)
      AND ($2::text IS NULL OR o.opus_name ILIKE '%' || $2 || '%')
      AND ($3::int IS NULL OR (o.activity_id=$3 AND o.award_rank IS NOT NULL))`;
    const params = [typeId ?? null, name ?? null, activityId ?? null, limit, (page - 1) * limit];
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT o.id AS opus_id,o.opus_name,cover.url AS cover_image,o.allow_clone,
         to_char(o.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
         jsonb_build_object('user_id',u.id,'nickname',COALESCE(u.nickname,u.username)) AS creator
         FROM opuses o JOIN users u ON u.id=o.created_by
         JOIN media_assets cover ON cover.id=o.cover_asset_id WHERE ${filter}
         ORDER BY o.id DESC LIMIT $4 OFFSET $5`,
        params,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM opuses o WHERE ${filter}`,
        params.slice(0, 3),
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 公开详情只含作品自愿公开的媒体与说明。 */
  async publicDetail(opusId: number, userId?: number): Promise<unknown> {
    const result = await this.db.query(
      `UPDATE opuses SET view_count=view_count+1 WHERE id=$1 AND published_at IS NOT NULL
       RETURNING id`,
      [opusId],
    );
    if (!result.rows[0]) throw new AppError(404, '作品不存在');
    const detail = await this.db.query(
      `SELECT o.id AS opus_id,o.opus_name,o.type_id,o.description AS describe,
       cover.url AS cover_image,video.url AS opus_video,o.allow_clone,
       to_char(o.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
       COALESCE(u.nickname,u.username) AS nickname,
       EXISTS(SELECT 1 FROM opus_collections oc WHERE oc.opus_id=o.id AND oc.user_id=$2) AS is_collected
       FROM opuses o JOIN users u ON u.id=o.created_by
       JOIN media_assets cover ON cover.id=o.cover_asset_id
       JOIN media_assets video ON video.id=o.video_asset_id WHERE o.id=$1 AND o.published_at IS NOT NULL`,
      [opusId, userId ?? null],
    );
    return detail.rows[0];
  }

  /** 返回当前用户收藏的仍公开作品。 */
  async collections(
    actor: Identity,
    page: number,
    limit: number,
  ): Promise<{ list: unknown[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT o.id AS opus_id,o.opus_name,cover.url AS cover_image,o.allow_clone,
         to_char(o.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
         jsonb_build_object('user_id',u.id,'nickname',COALESCE(u.nickname,u.username)) AS creator
         FROM opus_collections oc JOIN opuses o ON o.id=oc.opus_id
         JOIN users u ON u.id=o.created_by JOIN media_assets cover ON cover.id=o.cover_asset_id
         WHERE oc.user_id=$1 AND o.published_at IS NOT NULL ORDER BY oc.created_at DESC LIMIT $2 OFFSET $3`,
        [actor.userId, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM opus_collections oc JOIN opuses o ON o.id=oc.opus_id
         WHERE oc.user_id=$1 AND o.published_at IS NOT NULL`,
        [actor.userId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 幂等设置作品收藏状态。 */
  async collect(
    actor: Identity,
    opusId: number,
    action: boolean,
  ): Promise<{ opus_id: number; is_collected: boolean }> {
    const opus = await this.db.query(
      'SELECT 1 FROM opuses WHERE id=$1 AND published_at IS NOT NULL',
      [opusId],
    );
    if (!opus.rowCount) throw new AppError(404, '作品不存在');
    if (action)
      await this.db.query(
        'INSERT INTO opus_collections(user_id,opus_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [actor.userId, opusId],
      );
    else
      await this.db.query('DELETE FROM opus_collections WHERE user_id=$1 AND opus_id=$2', [
        actor.userId,
        opusId,
      ]);
    return { opus_id: opusId, is_collected: action };
  }

  /** 克隆仅调用已发布且 allow_clone 的项目复制流程。 */
  async clone(actor: Identity, opusId: number): Promise<{ drama_id: number }> {
    return this.projects.clonePublishedDrama(actor, opusId);
  }

  /** 展示公开作品中除当前项以外浏览和收藏较多的作品。 */
  async top(opusId: number): Promise<unknown[]> {
    const opus = await this.db.query(
      'SELECT 1 FROM opuses WHERE id=$1 AND published_at IS NOT NULL',
      [opusId],
    );
    if (!opus.rowCount) throw new AppError(404, '作品不存在');
    const result = await this.db.query(
      `SELECT o.id AS opus_id,o.opus_name,cover.url AS cover_image,o.allow_clone,
       to_char(o.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
       jsonb_build_object('user_id',u.id,'nickname',COALESCE(u.nickname,u.username)) AS creator
       FROM opuses o JOIN users u ON u.id=o.created_by
       JOIN media_assets cover ON cover.id=o.cover_asset_id
       WHERE o.id<>$1 AND o.published_at IS NOT NULL
       ORDER BY o.view_count DESC,o.id DESC LIMIT 10`,
      [opusId],
    );
    return result.rows;
  }

  /** 仅允许查看可克隆作品已发布画布的节点与连线。 */
  async process(opusId: number): Promise<unknown> {
    const opus = await this.db.query<{ canvas_id: number }>(
      'SELECT canvas_id FROM opuses WHERE id=$1 AND published_at IS NOT NULL AND allow_clone',
      [opusId],
    );
    if (!opus.rows[0]) throw new AppError(404, '制作过程不可用');
    const [nodes, connections] = await Promise.all([
      this.db.query(
        `SELECT uuid,type,node_name,position_x,position_y,width,height,content
         FROM nodes WHERE canvas_id=$1 ORDER BY id`,
        [opus.rows[0].canvas_id],
      ),
      this.db.query(
        `SELECT uuid,source_uuid,target_uuid,source_anchor,target_anchor,type
         FROM connections WHERE canvas_id=$1 ORDER BY id`,
        [opus.rows[0].canvas_id],
      ),
    ]);
    return { nodes: nodes.rows, connections: connections.rows };
  }
}
