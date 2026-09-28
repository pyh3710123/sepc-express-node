import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';
import { PermissionsService } from '../permissions/permissions.service';
import type { AssetHistoryQuery, AssetQuery } from './assets.schemas';

interface AssetRow extends QueryResultRow {
  asset_id: number;
  asset_type: 'image' | 'video' | 'audio';
  asset_link: string;
  cover_image: string;
  create_date: string;
  created_at: Date;
  creator_id: number | null;
}

@Injectable()
export class AssetsService {
  /** 查询和删除当前账号登记的媒体对象，团队共享受权限开关限制。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  /** 计算当前请求可见的账号和创建人条件。 */
  private async scope(
    actor: Identity,
    belongType?: AssetQuery['belong_type'],
  ): Promise<{ accountId: number; creatorId: number | null }> {
    if (belongType === 'private') {
      const personal = await this.db.query<{ id: number }>(
        `SELECT id FROM accounts WHERE type='personal' AND owner_user_id=$1 AND dissolved_at IS NULL ORDER BY id LIMIT 1`,
        [actor.userId],
      );
      if (!personal.rows[0]) throw new AppError(404, '个人账号不存在');
      return { accountId: personal.rows[0].id, creatorId: null };
    }
    const account = await this.db.query<{ type: string }>('SELECT type FROM accounts WHERE id=$1', [
      actor.accountId,
    ]);
    if (belongType === 'team' && account.rows[0]?.type !== 'team')
      throw new AppError(404, '团队不存在');
    const settings = await this.permissions.global(actor);
    return {
      accountId: actor.accountId,
      creatorId: actor.role === 'member' && !settings.assets_share ? actor.userId : null,
    };
  }

  /** 按媒体类型、日期和归属过滤真实登记资产。 */
  private async rows(
    actor: Identity,
    input: AssetQuery,
  ): Promise<{ list: AssetRow[]; total: number }> {
    if (input.belong_type === 'public') return this.publicRows(input);
    const scope = await this.scope(actor, input.belong_type);
    const params: unknown[] = [
      scope.accountId,
      scope.creatorId,
      input.asset_type ?? null,
      input.start_date ?? null,
      input.end_date ?? null,
      input.keyword ?? null,
      input.format ?? null,
      input.limit,
      (input.page - 1) * input.limit,
    ];
    const filter = `a.account_id=$1 AND ($2::int IS NULL OR a.created_by=$2)
      AND ($3::text IS NULL OR split_part(a.mime_type,'/',1)=$3)
      AND ($4::date IS NULL OR a.created_at >= $4::date)
      AND ($5::date IS NULL OR a.created_at < $5::date + interval '1 day')
      AND ($6::text IS NULL OR a.object_key ILIKE '%' || $6 || '%')
      AND ($7::text IS NULL OR split_part(a.mime_type,'/',1)=CASE WHEN $7='picture' THEN 'image' ELSE $7 END)`;
    const [rows, count] = await Promise.all([
      this.db.query<AssetRow>(
        `SELECT a.id AS asset_id,split_part(a.mime_type,'/',1) AS asset_type,a.url AS asset_link,
         CASE WHEN a.mime_type LIKE 'image/%' THEN a.url ELSE '' END AS cover_image,
         to_char(a.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS create_date,
         a.created_at,a.created_by AS creator_id FROM media_assets a WHERE ${filter}
         ORDER BY a.created_at DESC,a.id DESC LIMIT $8 OFFSET $9`,
        params,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM media_assets a WHERE ${filter}`,
        params.slice(0, 7),
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 公共目录只展示后台已发布的真实媒体记录，账号资产与公共目录互不混用。 */
  private async publicRows(input: AssetQuery): Promise<{ list: AssetRow[]; total: number }> {
    const params: unknown[] = [
      input.asset_type ?? null,
      input.start_date ?? null,
      input.end_date ?? null,
      input.keyword ?? null,
      input.format ?? null,
      input.limit,
      (input.page - 1) * input.limit,
    ];
    const filter = `a.published
      AND ($1::text IS NULL OR split_part(a.mime_type,'/',1)=$1)
      AND ($2::date IS NULL OR a.created_at >= $2::date)
      AND ($3::date IS NULL OR a.created_at < $3::date + interval '1 day')
      AND ($4::text IS NULL OR a.title ILIKE '%' || $4 || '%' OR a.object_key ILIKE '%' || $4 || '%')
      AND ($5::text IS NULL OR split_part(a.mime_type,'/',1)=CASE WHEN $5='picture' THEN 'image' ELSE $5 END)`;
    const [rows, count] = await Promise.all([
      this.db.query<AssetRow>(
        `SELECT a.id AS asset_id,split_part(a.mime_type,'/',1) AS asset_type,a.url AS asset_link,
         CASE WHEN a.mime_type LIKE 'image/%' THEN a.url ELSE '' END AS cover_image,
         to_char(a.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS create_date,
         a.created_at,NULL::int AS creator_id FROM public_media_assets a WHERE ${filter}
         ORDER BY a.created_at DESC,a.id DESC LIMIT $6 OFFSET $7`,
        params,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM public_media_assets a WHERE ${filter}`,
        params.slice(0, 5),
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 页面返回日期分组；选择弹窗按既有协议返回 list/total。 */
  async list(actor: Identity, input: AssetQuery): Promise<unknown> {
    const result = await this.rows(actor, input);
    if (input.belong_type)
      return {
        list: result.list.map((item) => ({ ...item, id: item.asset_id, url: item.asset_link })),
        total: result.total,
      };
    const grouped: Record<string, AssetRow[]> = {};
    for (const item of result.list) (grouped[item.create_date] ??= []).push(item);
    return grouped;
  }

  /** 生成历史只暴露已登记的当前账号媒体，并校验成员筛选属于团队。 */
  async history(
    actor: Identity,
    input: AssetHistoryQuery,
  ): Promise<{ list: AssetRow[]; total: number }> {
    const userIds = input.users?.split(',').map(Number) ?? [];
    if (userIds.length) {
      const membership = await this.db.query<{ user_id: number }>(
        `SELECT user_id FROM account_members WHERE account_id=$1 AND status='active' AND user_id=ANY($2::int[])`,
        [actor.accountId, userIds],
      );
      if (membership.rows.length !== new Set(userIds).size) throw new AppError(404, '成员不存在');
    }
    const settings = await this.permissions.global(actor);
    const creatorId = actor.role === 'member' && !settings.assets_share ? actor.userId : null;
    const params: unknown[] = [
      actor.accountId,
      creatorId,
      input.asset_type ?? null,
      userIds.length ? userIds : null,
      input.limit,
      (input.page - 1) * input.limit,
    ];
    const filter = `a.account_id=$1 AND ($2::int IS NULL OR a.created_by=$2)
      AND ($3::text IS NULL OR split_part(a.mime_type,'/',1)=$3)
      AND ($4::int[] IS NULL OR a.created_by=ANY($4::int[]))`;
    const [rows, count] = await Promise.all([
      this.db.query<AssetRow>(
        `SELECT a.id AS asset_id,split_part(a.mime_type,'/',1) AS asset_type,a.url AS asset_link,
         CASE WHEN a.mime_type LIKE 'image/%' THEN a.url ELSE '' END AS cover_image,
         to_char(a.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS create_date,
         a.created_at,a.created_by AS creator_id FROM media_assets a WHERE ${filter}
         ORDER BY a.created_at DESC,a.id DESC LIMIT $5 OFFSET $6`,
        params,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM media_assets a WHERE ${filter}`,
        params.slice(0, 4),
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 删除前检查所有已知项目和素材引用，整个批次要么全部删除要么全部保留。 */
  async delete(actor: Identity, ids: number[]): Promise<{ deleted: number }> {
    if (new Set(ids).size !== ids.length) throw new AppError(400, '资产 ID 不得重复');
    return this.db.transaction(async (client) => {
      const assets = await client.query<{ id: number; url: string; created_by: number | null }>(
        `SELECT id,url,created_by FROM media_assets WHERE account_id=$1 AND id=ANY($2::int[])
         ORDER BY id FOR UPDATE`,
        [actor.accountId, ids],
      );
      if (assets.rows.length !== ids.length) throw new AppError(404, '资产不存在');
      for (const asset of assets.rows) {
        if (actor.role === 'member' && asset.created_by !== actor.userId)
          throw new AppError(404, '资产不存在');
        const refs = await client.query(
          `SELECT 1 FROM media_assets WHERE origin_asset_id=$1
           UNION ALL SELECT 1 FROM nodes n JOIN canvases c ON c.id=n.canvas_id
             WHERE c.account_id=$2 AND (n.content=$3 OR position($3 in n.extra_data::text)>0)
           UNION ALL SELECT 1 FROM materials WHERE account_id=$2 AND (content=$3 OR cover_image=$3 OR position($3 in node_data::text)>0)
           UNION ALL SELECT 1 FROM subjects WHERE account_id=$2 AND position($3 in content::text)>0
           UNION ALL SELECT 1 FROM subject_timbres WHERE account_id=$2 AND audio_url=$3
           UNION ALL SELECT 1 FROM canvas_library_nodes WHERE account_id=$2 AND (cover_image=$3 OR position($3 in node_data::text)>0)
           UNION ALL SELECT 1 FROM opuses WHERE account_id=$2 AND (cover_asset_id=$1 OR video_asset_id=$1)
           LIMIT 1`,
          [asset.id, actor.accountId, asset.url],
        );
        if (refs.rowCount) throw new AppError(409, '资产仍被项目或素材引用');
      }
      await client.query('DELETE FROM media_assets WHERE account_id=$1 AND id=ANY($2::int[])', [
        actor.accountId,
        ids,
      ]);
      return { deleted: ids.length };
    });
  }
}
