import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { AppError } from '../../common';
import type { Identity } from '../auth';
import { Database, type QueryExecutor } from '../../database';
import type { CreateDramaInput, UpdateDramaInput } from './projects.schemas';
import { PermissionsService } from '../permissions/permissions.service';

/** 同一账号的项目树修改使用同一个事务锁，避免移动与删除并发时出现误删。 */
const DRAMA_TREE_LOCK_NAMESPACE = 31601;

/** 回收站项目保留 30 天。 */
const RECYCLE_RETENTION_DAYS = 30;
/** 单轮以 100 个项目为清理阈值，项目组会连同子项目一起删除。 */
export const RECYCLE_PURGE_BATCH_SIZE = 100;

interface DramaSummary extends QueryResultRow {
  drama_id: number;
  title: string;
  type: string;
  is_group: boolean;
  parent_id: number | null;
  canvas_id: number | null;
  cover_image: string | null;
  child_count: number;
  create_time: string;
  permission_code: string;
  created_at: Date;
  updated_at: Date;
}

interface RecycledDrama extends QueryResultRow {
  id: number;
  drama_id: number;
  project_name: string;
  project_type: 'drama';
  project_create_time: string;
  project_delete_time: string;
  deleted_at: Date;
}

interface DramaSubsetItem extends QueryResultRow {
  drama_id: number;
  title: string;
  parent_id: number | null;
  canvas_id: number | null;
}

interface ExpiredDrama extends QueryResultRow {
  id: number;
  account_id: number;
  deleted_at_cursor: string;
}

interface ImportDrama extends QueryResultRow {
  id: number;
  parent_id: number | null;
  type: string;
  title: string;
  cover_image: string | null;
}

interface ImportCanvas extends QueryResultRow {
  id: number;
  drama_id: number;
  title: string;
  schema_version: number;
}

interface ImportNode extends QueryResultRow {
  id: number;
  canvas_id: number;
  uuid: string;
  type: string;
  node_name: string;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  parent_uuid: string | null;
  z_index: number;
  content: string | null;
  extra_data: Record<string, unknown>;
}

interface ImportAsset extends QueryResultRow {
  id: number;
  object_key: string;
  mime_type: string;
  size_byte: string;
  url: string;
}

/** 递归收集节点中的媒体 URL 和登记 ID，导入前需再次核对个人账号归属。 */
function collectAssetRefs(value: unknown, urls: Set<string>, ids: Set<number>): void {
  if (typeof value === 'string' && /^(https?:\/\/|mock:\/\/|oss:\/\/)/.test(value)) {
    urls.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAssetRefs(item, urls, ids);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'asset_id' && Number.isSafeInteger(Number(item)) && Number(item) > 0)
        ids.add(Number(item));
      collectAssetRefs(item, urls, ids);
    }
  }
}

/** 复制节点 JSON 时把个人账号的媒体 ID 改写为团队账号新登记 ID。 */
function remapAssetRefs(value: unknown, assetIds: Map<number, number>): unknown {
  if (Array.isArray(value)) return value.map((item) => remapAssetRefs(item, assetIds));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'asset_id' && assetIds.has(Number(item))
        ? assetIds.get(Number(item))
        : remapAssetRefs(item, assetIds),
    ]),
  );
}

@Injectable()
export class ProjectsService {
  /** 注入数据库，处理项目树、回收站和项目组事务。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  /** 串行化当前账号的项目树修改，随后再取具体项目行锁。 */
  private async lockDramaTree(client: QueryExecutor, accountId: number): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [
      DRAMA_TREE_LOCK_NAMESPACE,
      accountId,
    ]);
  }

  /** 只接受当前用户所有的个人账号作为团队导入来源。 */
  private async personalAccount(actor: Identity, query: QueryExecutor = this.db): Promise<number> {
    const result = await query.query<{ id: number }>(
      `SELECT a.id FROM accounts a JOIN account_members m ON m.account_id=a.id
       WHERE a.type='personal' AND a.owner_user_id=$1 AND a.dissolved_at IS NULL
       AND m.user_id=$1 AND m.status='active' ORDER BY a.id LIMIT 1`,
      [actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '个人账号不存在');
    return result.rows[0].id;
  }

  /** 查询可从个人账号导入的项目，权限仍按个人账号所有者计算。 */
  async personalDramas(
    actor: Identity,
    page: number,
    limit: number,
    name?: string,
  ): ReturnType<ProjectsService['listDramas']> {
    const accountId = await this.personalAccount(actor);
    return this.listDramas({ ...actor, accountId, role: 'owner' }, page, limit, {
      name,
      parentId: 0,
      all: '0',
    });
  }

  /** 返回个人账号中所有可导入的短剧项目。 */
  async personalSubset(
    actor: Identity,
    page?: number,
    limit?: number,
  ): ReturnType<ProjectsService['subsetDramas']> {
    const accountId = await this.personalAccount(actor);
    return this.subsetDramas({ ...actor, accountId, role: 'owner' }, page, limit);
  }

  /** 复制个人项目树、画布、节点、连线及已登记媒体归属，不改变原项目。 */
  async importPersonalDramas(
    actor: Identity,
    input: { parent_id: number; ids: number[] },
  ): Promise<{ imported_ids: number[] }> {
    const sourceAccountId = await this.personalAccount(actor);
    if (sourceAccountId === actor.accountId) throw new AppError(400, '只能导入到团队账号');
    return this.copyDramas(actor, sourceAccountId, input, true);
  }

  /** 仅从仍公开且允许克隆的作品复制已发布画布与账号媒体登记。 */
  async clonePublishedDrama(actor: Identity, opusId: number): Promise<{ drama_id: number }> {
    const opus = await this.db.query<{ account_id: number; drama_id: number; canvas_id: number }>(
      'SELECT account_id,drama_id,canvas_id FROM opuses WHERE id=$1 AND published_at IS NOT NULL AND allow_clone',
      [opusId],
    );
    if (!opus.rows[0]) throw new AppError(404, '可克隆作品不存在');
    const copied = await this.copyDramas(
      actor,
      opus.rows[0].account_id,
      { parent_id: 0, ids: [opus.rows[0].drama_id] },
      false,
      opusId,
      opus.rows[0].canvas_id,
    );
    return { drama_id: copied.imported_ids[0] };
  }

  /** 在锁定源作品和两端项目树后复制节点、连线及媒体登记。 */
  private async copyDramas(
    actor: Identity,
    sourceAccountId: number,
    input: { parent_id: number; ids: number[] },
    targetTeamOnly: boolean,
    sourceOpusId?: number,
    sourceCanvasId?: number,
  ): Promise<{ imported_ids: number[] }> {
    if (new Set(input.ids).size !== input.ids.length) throw new AppError(400, '项目 ID 不得重复');
    return this.db.transaction(async (client) => {
      if (sourceOpusId) {
        const published = await client.query(
          `SELECT 1 FROM opuses WHERE id=$1 AND account_id=$2 AND drama_id=$3 AND canvas_id=$4
           AND published_at IS NOT NULL AND allow_clone FOR SHARE`,
          [sourceOpusId, sourceAccountId, input.ids[0], sourceCanvasId],
        );
        if (!published.rowCount) throw new AppError(404, '可克隆作品不存在');
      }
      const target = await client.query(
        `SELECT 1 FROM accounts WHERE id=$1 AND ($2::boolean=false OR type='team')
         AND dissolved_at IS NULL FOR SHARE`,
        [actor.accountId, targetTeamOnly],
      );
      if (!target.rowCount)
        throw new AppError(400, targetTeamOnly ? '只能导入到团队账号' : '目标账号不存在');
      for (const accountId of [...new Set([sourceAccountId, actor.accountId])].sort(
        (a, b) => a - b,
      ))
        await this.lockDramaTree(client, accountId);
      await this.permissions.assertCanCreate(actor, client);
      if (input.parent_id) {
        const parent = await client.query(
          `SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2 AND type='group'
           AND deleted_at IS NULL FOR SHARE`,
          [input.parent_id, actor.accountId],
        );
        if (!parent.rowCount) throw new AppError(404, '目标项目组不存在');
        await this.permissions.assertProject(actor, 'drama', input.parent_id, 'edit', client);
      }
      const roots = await client.query<{ id: number }>(
        `SELECT id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2 AND deleted_at IS NULL`,
        [input.ids, sourceAccountId],
      );
      if (roots.rows.length !== input.ids.length) throw new AppError(404, '来源项目不存在');
      const projects = await client.query<ImportDrama>(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2 AND deleted_at IS NULL
           UNION SELECT child.id FROM dramas child JOIN tree parent ON child.parent_id=parent.id
           WHERE child.account_id=$2 AND child.deleted_at IS NULL AND $3::boolean
         ) SELECT d.id,d.parent_id,d.type,d.title,d.cover_image FROM dramas d
         JOIN tree t ON t.id=d.id ORDER BY d.id FOR UPDATE OF d`,
        [input.ids, sourceAccountId, sourceOpusId === undefined],
      );
      if (projects.rows.length > 1000) throw new AppError(400, '单次导入项目数量超限');
      const sourceIds = projects.rows.map((project) => project.id);
      const canvases = await client.query<ImportCanvas>(
        `SELECT id,drama_id,title,schema_version FROM canvases
         WHERE drama_id=ANY($1::int[]) AND account_id=$2 AND ($3::int IS NULL OR id=$3)
         ORDER BY id FOR SHARE`,
        [sourceIds, sourceAccountId, sourceCanvasId ?? null],
      );
      const canvasIds = canvases.rows.map((canvas) => canvas.id);
      const nodes = canvasIds.length
        ? await client.query<ImportNode>(
            `SELECT id,canvas_id,uuid,type,node_name,position_x,position_y,width,height,parent_uuid,
             z_index,content,extra_data FROM nodes WHERE canvas_id=ANY($1::int[]) ORDER BY id`,
            [canvasIds],
          )
        : { rows: [] as ImportNode[] };
      if (nodes.rows.length > 10000) throw new AppError(400, '单次导入节点数量超限');
      const urls = new Set<string>();
      const assetIds = new Set<number>();
      for (const project of projects.rows) collectAssetRefs(project.cover_image, urls, assetIds);
      for (const node of nodes.rows) {
        collectAssetRefs(node.content, urls, assetIds);
        collectAssetRefs(node.extra_data, urls, assetIds);
      }
      const assets = await client.query<ImportAsset>(
        `SELECT id,object_key,mime_type,size_byte,url FROM media_assets
         WHERE account_id=$1 AND (id=ANY($2::int[]) OR url=ANY($3::text[])) ORDER BY id`,
        [sourceAccountId, [...assetIds], [...urls]],
      );
      if (
        assetIds.size &&
        [...assetIds].some((id) => !assets.rows.some((asset) => asset.id === id))
      )
        throw new AppError(404, '项目引用的媒体资产不存在');
      if (urls.size) {
        const missingUrls = [...urls].filter(
          (url) => !assets.rows.some((asset) => asset.url === url),
        );
        if (missingUrls.length) {
          // 公共素材由平台持有，只要仍公开即可在目标账号继续引用，无需伪造私有登记。
          const publicAssets = await client.query<{ url: string }>(
            'SELECT url FROM public_media_assets WHERE published AND url=ANY($1::text[])',
            [missingUrls],
          );
          const publishedUrls = new Set(publicAssets.rows.map((asset) => asset.url));
          if (missingUrls.some((url) => !publishedUrls.has(url)))
            throw new AppError(404, '项目引用的媒体资产不存在');
        }
      }
      const copiedAssetIds = new Map<number, number>();
      for (const asset of assets.rows) {
        // 保留不可变对象键和 URL，并为目标账号建立独立登记；来源登记始终保留。
        const copied = await client.query<{ id: number; url: string; mime_type: string }>(
          `INSERT INTO media_assets(account_id,object_key,mime_type,size_byte,url,origin_asset_id,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (account_id,object_key) DO UPDATE SET updated_at=media_assets.updated_at
           RETURNING id,url,mime_type`,
          [
            actor.accountId,
            asset.object_key,
            asset.mime_type,
            asset.size_byte,
            asset.url,
            asset.id,
            actor.userId,
          ],
        );
        if (copied.rows[0].url !== asset.url || copied.rows[0].mime_type !== asset.mime_type)
          throw new AppError(409, '目标账号媒体对象键冲突');
        copiedAssetIds.set(asset.id, copied.rows[0].id);
      }
      const imported = new Map<number, number>();
      const pending = new Map(projects.rows.map((project) => [project.id, project]));
      while (pending.size) {
        let progress = false;
        for (const project of [...pending.values()]) {
          if (project.parent_id && pending.has(project.parent_id)) continue;
          const parentId =
            project.parent_id && imported.has(project.parent_id)
              ? imported.get(project.parent_id)
              : input.parent_id || null;
          const created = await client.query<{ id: number }>(
            `INSERT INTO dramas(account_id,created_by,title,type,parent_id,cover_image)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [
              actor.accountId,
              actor.userId,
              project.title,
              project.type,
              parentId,
              sourceOpusId ? '' : project.cover_image,
            ],
          );
          imported.set(project.id, created.rows[0].id);
          pending.delete(project.id);
          progress = true;
        }
        if (!progress) throw new AppError(409, '来源项目树存在循环');
      }
      for (const canvas of canvases.rows) {
        const copied = await client.query<{ id: number }>(
          `INSERT INTO canvases(account_id,drama_id,title,schema_version)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [actor.accountId, imported.get(canvas.drama_id), canvas.title, canvas.schema_version],
        );
        const newCanvasId = copied.rows[0].id;
        for (const node of nodes.rows.filter((item) => item.canvas_id === canvas.id)) {
          await client.query(
            `INSERT INTO nodes(canvas_id,uuid,type,node_name,position_x,position_y,width,height,
             parent_uuid,z_index,content,extra_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              newCanvasId,
              node.uuid,
              node.type,
              node.node_name,
              node.position_x,
              node.position_y,
              node.width,
              node.height,
              node.parent_uuid,
              node.z_index,
              node.content,
              JSON.stringify(remapAssetRefs(node.extra_data, copiedAssetIds)),
            ],
          );
        }
        await client.query(
          `INSERT INTO connections(canvas_id,uuid,source_uuid,target_uuid,source_anchor,target_anchor,type,extra_data)
           SELECT $1,uuid,source_uuid,target_uuid,source_anchor,target_anchor,type,extra_data
           FROM connections WHERE canvas_id=$2`,
          [newCanvasId, canvas.id],
        );
      }
      return {
        imported_ids: input.ids.map((id) => {
          const newId = imported.get(id);
          if (!newId) throw new AppError(409, '项目导入失败');
          return newId;
        }),
      };
    });
  }

  /** 分页返回当前账号下未删除的项目。 */
  async listDramas(
    actor: Identity,
    page: number,
    limit: number,
    filters: { parentId?: number; name?: string; all: '0' | '1' | '2' },
  ): Promise<{ list: DramaSummary[]; total: number; drama_total: number; group_total: number }> {
    const values = [actor.accountId, filters.parentId ?? null, filters.name ?? null];
    const [rows, totals] = await Promise.all([
      this.db.query<DramaSummary>(
        `SELECT d.id AS drama_id,d.title,d.type,d.type='group' AS is_group,d.parent_id,
                c.canvas_id,d.cover_image,
                (SELECT count(*)::int FROM dramas child WHERE child.parent_id=d.id AND child.deleted_at IS NULL) AS child_count,
                to_char(d.created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS create_time,
                CASE WHEN $7::text='member' THEN COALESCE(p.permission_code,'editor') ELSE 'owner' END AS permission_code,
                d.created_at,d.updated_at
         FROM dramas d
         LEFT JOIN project_permissions p ON p.account_id=d.account_id AND p.project_type='drama'
           AND p.project_id=d.id AND p.user_id=$8
         LEFT JOIN LATERAL (SELECT id AS canvas_id FROM canvases WHERE drama_id=d.id ORDER BY id LIMIT 1) c ON true
         WHERE d.account_id=$1 AND d.deleted_at IS NULL
           AND ($7::text<>'member' OR COALESCE(p.permission_code,'editor')<>'none')
           AND ($2::int IS NULL OR ($2=0 AND d.parent_id IS NULL) OR d.parent_id=$2)
           AND ($3::text IS NULL OR strpos(lower(d.title),lower($3))>0)
           AND ($4='0' OR ($4='1' AND d.type='group') OR ($4='2' AND d.type<>'group'))
         ORDER BY d.id DESC LIMIT $5 OFFSET $6`,
        [...values, filters.all, limit, (page - 1) * limit, actor.role, actor.userId],
      ),
      this.db.query<{ group_total: number; drama_total: number }>(
        `SELECT count(*) FILTER (WHERE type='group')::int AS group_total,
                count(*) FILTER (WHERE type<>'group')::int AS drama_total
         FROM dramas d LEFT JOIN project_permissions p ON p.account_id=d.account_id
           AND p.project_type='drama' AND p.project_id=d.id AND p.user_id=$5
         WHERE d.account_id=$1 AND d.deleted_at IS NULL
           AND ($4::text<>'member' OR COALESCE(p.permission_code,'editor')<>'none')
           AND ($2::int IS NULL OR ($2=0 AND parent_id IS NULL) OR parent_id=$2)
           AND ($3::text IS NULL OR strpos(lower(title),lower($3))>0)`,
        [...values, actor.role, actor.userId],
      ),
    ]);
    const { group_total, drama_total } = totals.rows[0];
    const total =
      filters.all === '1'
        ? group_total
        : filters.all === '2'
          ? drama_total
          : group_total + drama_total;
    return { list: rows.rows, total, drama_total, group_total };
  }

  /** 平铺当前账号所有未删除短剧，供团队权限选择器读取组内项目。 */
  async subsetDramas(
    actor: Identity,
    page?: number,
    limit?: number,
  ): Promise<{ list: DramaSubsetItem[]; total: number }> {
    const pageSize = page === undefined && limit === undefined ? null : (limit ?? 100);
    const [rows, count] = await Promise.all([
      this.db.query<DramaSubsetItem>(
        `SELECT d.id AS drama_id,d.title,d.parent_id,
                (SELECT id FROM canvases WHERE drama_id=d.id ORDER BY id LIMIT 1) AS canvas_id
         FROM dramas d LEFT JOIN project_permissions p ON p.account_id=d.account_id
           AND p.project_type='drama' AND p.project_id=d.id AND p.user_id=$5
         WHERE d.account_id=$1 AND d.type='drama' AND d.deleted_at IS NULL
           AND ($4::text<>'member' OR COALESCE(p.permission_code,'editor')<>'none')
         ORDER BY d.id DESC LIMIT $2 OFFSET $3`,
        [actor.accountId, pageSize, ((page ?? 1) - 1) * (pageSize ?? 0), actor.role, actor.userId],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM dramas d LEFT JOIN project_permissions p
         ON p.account_id=d.account_id AND p.project_type='drama' AND p.project_id=d.id AND p.user_id=$3
         WHERE d.account_id=$1 AND d.type='drama' AND d.deleted_at IS NULL
           AND ($2::text<>'member' OR COALESCE(p.permission_code,'editor')<>'none')`,
        [actor.accountId, actor.role, actor.userId],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 创建短剧或项目组；短剧同时创建首张画布，供前端直接进入工作台。 */
  async createDrama(
    actor: Identity,
    input: CreateDramaInput,
  ): Promise<{ drama_id: number; canvas_id?: number }> {
    return this.db.transaction(async (client) => {
      await this.lockDramaTree(client, actor.accountId);
      await this.permissions.assertCanCreate(actor, client);
      if (input.parent_id > 0) {
        const parent = await client.query(
          `SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2 AND type='group'
           AND deleted_at IS NULL FOR SHARE`,
          [input.parent_id, actor.accountId],
        );
        if (!parent.rowCount) throw new AppError(404, '项目组不存在');
        await this.permissions.assertProject(actor, 'drama', input.parent_id, 'edit', client);
      }
      const type = input.is_group ? 'group' : 'drama';
      const title = input.title ?? (input.is_group ? '未命名项目组' : '未命名项目');
      const created = await client.query<{ id: number }>(
        `INSERT INTO dramas(account_id,created_by,title,type,parent_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [actor.accountId, actor.userId, title, type, input.parent_id || null],
      );
      const dramaId = created.rows[0].id;
      if (input.is_group) return { drama_id: dramaId };
      const canvas = await client.query<{ id: number }>(
        `INSERT INTO canvases(account_id,drama_id,title) VALUES ($1,$2,'画布 1') RETURNING id`,
        [actor.accountId, dramaId],
      );
      return { drama_id: dramaId, canvas_id: canvas.rows[0].id };
    });
  }

  /** 更新标题或经当前账号资产登记验证的封面。 */
  async updateDrama(
    actor: Identity,
    input: UpdateDramaInput,
  ): Promise<{ drama_id: number; title: string; cover_image: string | null }> {
    await this.permissions.assertProject(actor, 'drama', input.drama_id, 'edit');
    if (input.cover_image) {
      // 封面必须来自当前账号已登记的图片，避免引用其他账号媒体或任意外链。
      const asset = await this.db.query(
        `SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE 'image/%'`,
        [actor.accountId, input.cover_image],
      );
      if (!asset.rowCount) throw new AppError(404, '封面资产不存在');
    }
    const result = await this.db.query<{ id: number; title: string; cover_image: string | null }>(
      `UPDATE dramas SET title=COALESCE($1,title),
       cover_image=CASE WHEN $2::boolean THEN $3 ELSE cover_image END,updated_at=now()
       WHERE id=$4 AND account_id=$5 AND deleted_at IS NULL RETURNING id,title,cover_image`,
      [
        input.title ?? null,
        input.cover_image !== undefined,
        input.cover_image ?? null,
        input.drama_id,
        actor.accountId,
      ],
    );
    if (!result.rows[0]) throw new AppError(404, '项目不存在');
    return {
      drama_id: result.rows[0].id,
      title: result.rows[0].title,
      cover_image: result.rows[0].cover_image,
    };
  }

  /** 校验批量项目 ID；按固定顺序锁行可降低并发批量操作的死锁概率。 */
  private sortedDramaIds(ids: number[]): number[] {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    if (sorted.length !== ids.length) throw new AppError(400, '项目 ID 不得重复');
    return sorted;
  }

  /** 移动一个或多个短剧项目；项目组只能作为目标，不能被移动为自身后代。 */
  async moveDramas(
    actor: Identity,
    input: { ids: number[]; action: 'remove' | 'transfer'; targetId?: number },
  ): Promise<{ moved_ids: number[]; parent_id: number | null }> {
    const sortedIds = this.sortedDramaIds(input.ids);
    return this.db.transaction(async (client) => {
      await this.lockDramaTree(client, actor.accountId);
      const parentId = input.action === 'transfer' ? input.targetId : null;
      if (input.action === 'transfer') {
        const target = await client.query(
          `SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2 AND type='group'
           AND deleted_at IS NULL FOR UPDATE`,
          [parentId, actor.accountId],
        );
        if (!target.rowCount) throw new AppError(404, '目标项目组不存在');
        await this.permissions.assertProject(actor, 'drama', parentId!, 'edit', client);
      }
      const projects = await client.query<{ id: number; type: string }>(
        `SELECT id,type FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
         AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [sortedIds, actor.accountId],
      );
      if (projects.rows.length !== sortedIds.length) throw new AppError(404, '项目不存在');
      if (projects.rows.some((row) => row.type !== 'drama'))
        throw new AppError(400, '只能移动短剧项目');
      for (const project of projects.rows)
        await this.permissions.assertProject(actor, 'drama', project.id, 'edit', client);
      await client.query(
        'UPDATE dramas SET parent_id=$1,updated_at=now() WHERE id=ANY($2::int[]) AND account_id=$3',
        [parentId, sortedIds, actor.accountId],
      );
      return { moved_ids: sortedIds, parent_id: parentId ?? null };
    });
  }

  /** 将同一层级的多个短剧合并到新项目组，保留原画布和项目 ID。 */
  async mergeDramas(
    actor: Identity,
    ids: number[],
  ): Promise<{ drama_id: number; moved_ids: number[] }> {
    const sortedIds = this.sortedDramaIds(ids);
    return this.db.transaction(async (client) => {
      await this.lockDramaTree(client, actor.accountId);
      const projects = await client.query<{ id: number; type: string; parent_id: number | null }>(
        `SELECT id,type,parent_id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
         AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [sortedIds, actor.accountId],
      );
      if (projects.rows.length !== sortedIds.length) throw new AppError(404, '项目不存在');
      if (projects.rows.some((row) => row.type !== 'drama'))
        throw new AppError(400, '只能合并短剧项目');
      await this.permissions.assertCanCreate(actor, client);
      for (const project of projects.rows)
        await this.permissions.assertProject(actor, 'drama', project.id, 'edit', client);
      const parentId = projects.rows[0].parent_id;
      if (projects.rows.some((row) => row.parent_id !== parentId))
        throw new AppError(409, '只能合并同一层级的项目');
      const group = await client.query<{ id: number }>(
        `INSERT INTO dramas(account_id,created_by,title,type,parent_id)
         VALUES ($1,$2,'未命名项目组','group',$3) RETURNING id`,
        [actor.accountId, actor.userId, parentId],
      );
      const groupId = group.rows[0].id;
      await client.query(
        'UPDATE dramas SET parent_id=$1,updated_at=now() WHERE id=ANY($2::int[]) AND account_id=$3',
        [groupId, sortedIds, actor.accountId],
      );
      return { drama_id: groupId, moved_ids: sortedIds };
    });
  }

  /** 解除项目组并把组内项目移到原层级，软删除的子项目也保留可恢复的父级。 */
  async untieDramas(actor: Identity, ids: number[]): Promise<{ untied_ids: number[] }> {
    if (actor.role === 'member') throw new AppError(403, '没有删除权限');
    const sortedIds = this.sortedDramaIds(ids);
    return this.db.transaction(async (client) => {
      await this.lockDramaTree(client, actor.accountId);
      const groups = await client.query<{ id: number; type: string; parent_id: number | null }>(
        `SELECT id,type,parent_id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
         AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [sortedIds, actor.accountId],
      );
      if (groups.rows.length !== sortedIds.length) throw new AppError(404, '项目组不存在');
      if (groups.rows.some((row) => row.type !== 'group'))
        throw new AppError(400, '只能解除项目组');
      if (groups.rows.some((row) => row.parent_id !== null && sortedIds.includes(row.parent_id)))
        throw new AppError(409, '请分次解除嵌套的项目组');
      const canvases = await client.query(
        'SELECT 1 FROM canvases WHERE drama_id=ANY($1::int[]) LIMIT 1',
        [sortedIds],
      );
      if (canvases.rowCount) throw new AppError(409, '项目组仍有关联画布');
      for (const group of groups.rows) {
        await client.query(
          'UPDATE dramas SET parent_id=$1,updated_at=now() WHERE parent_id=$2 AND account_id=$3',
          [group.parent_id, group.id, actor.accountId],
        );
        await client.query('DELETE FROM dramas WHERE id=$1 AND account_id=$2', [
          group.id,
          actor.accountId,
        ]);
      }
      return { untied_ids: sortedIds };
    });
  }

  /** 批量软删除项目及其未删除的子项目，使画布立即从普通读取和生成入口消失。 */
  async deleteDramas(actor: Identity, ids: number[]): Promise<{ deleted_ids: number[] }> {
    if (actor.role === 'member') throw new AppError(403, '没有删除权限');
    const sortedIds = this.sortedDramaIds(ids);
    return this.db.transaction(async (client) => {
      await this.lockDramaTree(client, actor.accountId);
      const targets = await client.query<{ id: number }>(
        `SELECT id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
         AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [sortedIds, actor.accountId],
      );
      if (targets.rows.length !== sortedIds.length) throw new AppError(404, '项目不存在');
      const subtree = await client.query<{ id: number }>(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
           UNION
           SELECT d.id FROM dramas d JOIN tree t ON d.parent_id=t.id
           WHERE d.account_id=$2 AND d.deleted_at IS NULL
         ) SELECT id FROM tree ORDER BY id`,
        [sortedIds, actor.accountId],
      );
      const deletedIds = subtree.rows.map((row) => row.id);
      await client.query('SELECT id FROM dramas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [
        deletedIds,
      ]);
      // 同一事务的 now() 相同；恢复项目组时可识别此次一并删除的子项目。
      await client.query(
        'UPDATE dramas SET deleted_at=now(),updated_at=now() WHERE id=ANY($1::int[])',
        [deletedIds],
      );
      return { deleted_ids: deletedIds };
    });
  }

  /** 分页查询当前账号的回收站，不暴露其他账号已删除项目。 */
  async recycledDramas(
    actor: Identity,
    page: number,
    limit: number,
    filters: { name?: string; type?: 'drama' | 'script' },
  ): Promise<{ list: RecycledDrama[]; total: number }> {
    const [rows, count] = await Promise.all([
      this.db.query<RecycledDrama>(
        `SELECT id,id AS drama_id,title AS project_name,'drama'::text AS project_type,
                to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS project_create_time,
                to_char(deleted_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS project_delete_time,
                deleted_at
         FROM dramas WHERE account_id=$1 AND deleted_at IS NOT NULL
           AND ($2::text IS NULL OR strpos(lower(title),lower($2))>0)
           AND ($3::text IS NULL OR $3='drama')
         ORDER BY deleted_at DESC,id DESC LIMIT $4 OFFSET $5`,
        [actor.accountId, filters.name ?? null, filters.type ?? null, limit, (page - 1) * limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM dramas WHERE account_id=$1 AND deleted_at IS NOT NULL
         AND ($2::text IS NULL OR strpos(lower(title),lower($2))>0)
         AND ($3::text IS NULL OR $3='drama')`,
        [actor.accountId, filters.name ?? null, filters.type ?? null],
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 批量恢复项目及同批删除的子项目；父项目仍在回收站时拒绝单独恢复子项目。 */
  async restoreDramas(actor: Identity, ids: number[]): Promise<{ restored_ids: number[] }> {
    if (actor.role === 'member') throw new AppError(403, '没有恢复权限');
    const sortedIds = this.sortedDramaIds(ids);
    return this.db.transaction(async (client) => {
      await this.lockDramaTree(client, actor.accountId);
      const targets = await client.query<{ id: number }>(
        `SELECT id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
         AND deleted_at IS NOT NULL ORDER BY id FOR UPDATE`,
        [sortedIds, actor.accountId],
      );
      if (targets.rows.length !== sortedIds.length) throw new AppError(404, '回收站项目不存在');
      const subtree = await client.query<{ id: number }>(
        `WITH RECURSIVE tree(id,deleted_at) AS (
           SELECT id,deleted_at FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
           UNION
           SELECT d.id,d.deleted_at FROM dramas d JOIN tree t ON d.parent_id=t.id
           WHERE d.account_id=$2 AND d.deleted_at=t.deleted_at
         ) SELECT id FROM tree ORDER BY id`,
        [sortedIds, actor.accountId],
      );
      const restoredIds = subtree.rows.map((row) => row.id);
      await client.query('SELECT id FROM dramas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [
        restoredIds,
      ]);
      const blocked = await client.query(
        `SELECT 1 FROM dramas d JOIN dramas p ON p.id=d.parent_id
         WHERE d.id=ANY($1::int[]) AND p.deleted_at IS NOT NULL
           AND NOT (p.id=ANY($1::int[])) LIMIT 1`,
        [restoredIds],
      );
      if (blocked.rowCount) throw new AppError(409, '请先恢复父项目');
      await client.query(
        'UPDATE dramas SET deleted_at=NULL,updated_at=now() WHERE id=ANY($1::int[])',
        [restoredIds],
      );
      return { restored_ids: restoredIds };
    });
  }

  /** 永久删除回收站项目及子项目；运行中任务仍保留项目供任务收尾。 */
  async destroyRecycledDramas(
    actor: Identity,
    dramaIds: number[],
  ): Promise<{ deleted_ids: number[] }> {
    if (actor.role === 'member') throw new AppError(403, '没有删除权限');
    const sortedIds = this.sortedDramaIds(dramaIds);
    return this.db.transaction(async (client) => {
      await this.lockDramaTree(client, actor.accountId);
      const targets = await client.query<{ id: number }>(
        `SELECT id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
         AND deleted_at IS NOT NULL ORDER BY id FOR UPDATE`,
        [sortedIds, actor.accountId],
      );
      if (targets.rows.length !== sortedIds.length) throw new AppError(404, '回收站项目不存在');
      const subtree = await client.query<{ id: number; deleted_at: Date | null }>(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
           UNION
           SELECT d.id FROM dramas d JOIN tree t ON d.parent_id=t.id WHERE d.account_id=$2
         ) SELECT d.id,d.deleted_at FROM dramas d JOIN tree t ON t.id=d.id ORDER BY d.id`,
        [sortedIds, actor.accountId],
      );
      if (subtree.rows.some((row) => row.deleted_at === null))
        throw new AppError(409, '项目组仍有未删除的子项目');
      const deletedIds = subtree.rows.map((row) => row.id);
      await client.query('SELECT id FROM dramas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [
        deletedIds,
      ]);
      const tasks = await client.query(
        `SELECT 1 FROM generation_tasks t JOIN canvases c ON c.id=t.canvas_id
         WHERE c.drama_id=ANY($1::int[]) AND t.status IN ('queued','running') LIMIT 1`,
        [deletedIds],
      );
      if (tasks.rowCount) throw new AppError(409, '项目仍有进行中的生成任务');
      // 数据库将终态任务的画布和节点外键置空，保留扣费及任务历史供审计。
      await client.query('UPDATE dramas SET parent_id=NULL WHERE id=ANY($1::int[])', [deletedIds]);
      await client.query('DELETE FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2', [
        deletedIds,
        actor.accountId,
      ]);
      return { deleted_ids: deletedIds };
    });
  }

  /** 清理超过保留期的回收站项目；跳过有新近子项目或运行中任务的项目。 */
  async purgeExpiredRecycledDramas(): Promise<number> {
    let deletedCount = 0;
    let cursor: { deletedAt: string; id: number } | undefined;
    while (deletedCount < RECYCLE_PURGE_BATCH_SIZE) {
      const candidates = await this.db.query<ExpiredDrama>(
        `SELECT d.id,d.account_id,d.deleted_at::text AS deleted_at_cursor FROM dramas d
         WHERE d.deleted_at <= now() - $1::int * interval '1 day'
           AND ($2::timestamptz IS NULL OR (d.deleted_at,d.id) > ($2::timestamptz,$3::int))
         ORDER BY d.deleted_at,d.id LIMIT $4`,
        [
          RECYCLE_RETENTION_DAYS,
          cursor?.deletedAt ?? null,
          cursor?.id ?? 0,
          RECYCLE_PURGE_BATCH_SIZE,
        ],
      );
      if (!candidates.rows.length) break;
      for (const candidate of candidates.rows) {
        // PostgreSQL 时间戳有微秒精度；保留原始文本游标，避免 Date 截断后重复扫描。
        cursor = { deletedAt: candidate.deleted_at_cursor, id: candidate.id };
        deletedCount += await this.db.transaction(async (client) => {
          await this.lockDramaTree(client, candidate.account_id);
          const target = await client.query<{ id: number }>(
            `SELECT id FROM dramas WHERE id=$1 AND account_id=$2
             AND deleted_at <= now() - $3::int * interval '1 day' FOR UPDATE`,
            [candidate.id, candidate.account_id, RECYCLE_RETENTION_DAYS],
          );
          if (!target.rowCount) return 0;
          const subtree = await client.query<{ id: number; expired: boolean }>(
            `WITH RECURSIVE tree(id) AS (
               SELECT id FROM dramas WHERE id=$1 AND account_id=$2
               UNION
               SELECT d.id FROM dramas d JOIN tree t ON d.parent_id=t.id
               WHERE d.account_id=$2
             ) SELECT d.id,
                 d.deleted_at IS NOT NULL
                   AND d.deleted_at <= now() - $3::int * interval '1 day' AS expired
               FROM dramas d JOIN tree t ON t.id=d.id ORDER BY d.id`,
            [candidate.id, candidate.account_id, RECYCLE_RETENTION_DAYS],
          );
          // 项目组的子项目各自拥有保留期；有未删除或未到期的子项目时不能级联清理。
          if (subtree.rows.some((row) => !row.expired)) return 0;
          const deletedIds = subtree.rows.map((row) => row.id);
          await client.query(
            'SELECT id FROM dramas WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',
            [deletedIds],
          );
          const tasks = await client.query(
            `SELECT 1 FROM generation_tasks t JOIN canvases c ON c.id=t.canvas_id
             WHERE c.drama_id=ANY($1::int[]) AND t.status IN ('queued','running') LIMIT 1`,
            [deletedIds],
          );
          if (tasks.rowCount) return 0;
          // 与手动永久删除一致，画布级联删除，任务和积分审计记录保留。
          await client.query('UPDATE dramas SET parent_id=NULL WHERE id=ANY($1::int[])', [
            deletedIds,
          ]);
          await client.query('DELETE FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2', [
            deletedIds,
            candidate.account_id,
          ]);
          return deletedIds.length;
        });
        if (deletedCount >= RECYCLE_PURGE_BATCH_SIZE) break;
      }
      if (candidates.rows.length < RECYCLE_PURGE_BATCH_SIZE) break;
    }
    return deletedCount;
  }
}
