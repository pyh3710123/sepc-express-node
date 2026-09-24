import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { AppError } from '../../common';
import type { Identity } from '../auth';
import { Database, type QueryExecutor } from '../../database';
import type { CreateDramaInput, UpdateDramaInput } from './projects.schemas';

/** 同一账号的项目树修改使用同一个事务锁，避免移动与删除并发时出现误删。 */
const DRAMA_TREE_LOCK_NAMESPACE = 31601;

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

@Injectable()
export class ProjectsService {
  /** 注入数据库，处理项目树、回收站和项目组事务。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 串行化当前账号的项目树修改，随后再取具体项目行锁。 */
  private async lockDramaTree(client: QueryExecutor, accountId: number): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock($1::int,$2::int)', [
      DRAMA_TREE_LOCK_NAMESPACE,
      accountId,
    ]);
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
                $7::text AS permission_code,d.created_at,d.updated_at
         FROM dramas d
         LEFT JOIN LATERAL (SELECT id AS canvas_id FROM canvases WHERE drama_id=d.id ORDER BY id LIMIT 1) c ON true
         WHERE d.account_id=$1 AND d.deleted_at IS NULL
           AND ($2::int IS NULL OR ($2=0 AND d.parent_id IS NULL) OR d.parent_id=$2)
           AND ($3::text IS NULL OR strpos(lower(d.title),lower($3))>0)
           AND ($4='0' OR ($4='1' AND d.type='group') OR ($4='2' AND d.type<>'group'))
         ORDER BY d.id DESC LIMIT $5 OFFSET $6`,
        [...values, filters.all, limit, (page - 1) * limit, actor.role],
      ),
      this.db.query<{ group_total: number; drama_total: number }>(
        `SELECT count(*) FILTER (WHERE type='group')::int AS group_total,
                count(*) FILTER (WHERE type<>'group')::int AS drama_total
         FROM dramas WHERE account_id=$1 AND deleted_at IS NULL
           AND ($2::int IS NULL OR ($2=0 AND parent_id IS NULL) OR parent_id=$2)
           AND ($3::text IS NULL OR strpos(lower(title),lower($3))>0)`,
        values,
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
         FROM dramas d WHERE d.account_id=$1 AND d.type='drama' AND d.deleted_at IS NULL
         ORDER BY d.id DESC LIMIT $2 OFFSET $3`,
        [actor.accountId, pageSize, ((page ?? 1) - 1) * (pageSize ?? 0)],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM dramas
         WHERE account_id=$1 AND type='drama' AND deleted_at IS NULL`,
        [actor.accountId],
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
      if (input.parent_id > 0) {
        const parent = await client.query(
          `SELECT 1 FROM dramas WHERE id=$1 AND account_id=$2 AND type='group'
           AND deleted_at IS NULL FOR SHARE`,
          [input.parent_id, actor.accountId],
        );
        if (!parent.rowCount) throw new AppError(404, '项目组不存在');
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
      }
      const projects = await client.query<{ id: number; type: string }>(
        `SELECT id,type FROM dramas WHERE id=ANY($1::int[]) AND account_id=$2
         AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [sortedIds, actor.accountId],
      );
      if (projects.rows.length !== sortedIds.length) throw new AppError(404, '项目不存在');
      if (projects.rows.some((row) => row.type !== 'drama'))
        throw new AppError(400, '只能移动短剧项目');
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
}
