import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import type { z } from 'zod';
import { AppError } from '../../common';
import { Database, type QueryExecutor } from '../../database';
import type { Identity } from '../auth';
import { PermissionsService } from '../permissions/permissions.service';
import type {
  createMaterial,
  createTimbre,
  subjectFields,
  upsertLibraryNode,
} from './library.schemas';

interface SourceNode extends QueryResultRow {
  drama_id: number;
  type: string;
  content: string | null;
  extra_data: Record<string, unknown>;
  width: number | null;
  height: number | null;
  z_index: number;
}

interface MaterialRow extends QueryResultRow {
  id: number;
  account_id: number;
  user_id: number;
  creator_id: number;
  category: string;
  mime_type: string;
  material_name: string;
  content: string;
  cover_image: string;
  node_id: number | null;
  node_data: Record<string, unknown>;
}

interface SubjectRow extends QueryResultRow {
  subject_id: number;
  account_id: number;
  user_id: number;
  creator_id: number;
  category: string;
  subject_name: string;
  description: string;
  content: string[];
  timbre_id: number;
  is_image: boolean;
  cover_image: string;
}

interface LibraryNodeRow extends QueryResultRow {
  id: number;
  canvas_node_id: number;
  account_id: number;
  user_id: number;
  title: string;
  remark: string;
  cover_image: string;
  tags: string[];
  parent_node_id: number | null;
  category: string;
  node_data: Record<string, unknown>;
}

type ListQuery = { page: number; limit: number; users?: string };

@Injectable()
export class LibraryService {
  /** 管理团队素材、主体和画布节点快照，校验来源与媒体资产归属。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  /** 判断当前成员能否读取其他成员保存的账号资产。 */
  private async canReadShared(actor: Identity): Promise<boolean> {
    if (actor.role !== 'member') return true;
    const settings = await this.permissions.global(actor);
    return settings.assets_share;
  }

  /** 把前端逗号分隔成员筛选转换为安全的整数 ID 数组。 */
  private userIds(raw?: string): number[] | null {
    if (!raw) return null;
    const values = raw.split(',').map((value) => Number(value.trim()));
    if (values.length > 100 || values.some((value) => !Number.isSafeInteger(value) || value <= 0))
      throw new AppError(400, '成员筛选无效');
    return [...new Set(values)];
  }

  /** 资源引用必须指向当前账号已经登记且类型匹配的媒体。 */
  private async assertMedia(
    actor: Identity,
    url: string,
    mimePrefix: string,
    query: QueryExecutor = this.db,
  ): Promise<void> {
    const asset = await query.query(
      `SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3 LIMIT 1`,
      [actor.accountId, url, `${mimePrefix}%`],
    );
    if (!asset.rowCount) throw new AppError(404, '媒体资产不存在');
  }

  /** 读取仍属于当前账号和未删除项目的节点，作为素材快照来源。 */
  private async sourceNode(
    actor: Identity,
    nodeId: number,
    query: QueryExecutor = this.db,
  ): Promise<SourceNode> {
    const result = await query.query<SourceNode>(
      `SELECT n.*,d.id AS drama_id FROM nodes n JOIN canvases c ON c.id=n.canvas_id
       JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL
       WHERE n.id=$1 AND c.account_id=$2 FOR SHARE OF d`,
      [nodeId, actor.accountId],
    );
    const node = result.rows[0];
    if (!node) throw new AppError(404, '来源节点不存在');
    await this.permissions.assertProject(actor, 'drama', node.drama_id, 'edit', query);
    return node;
  }

  /** 按来源节点保存素材及其节点快照。 */
  async createMaterial(
    actor: Identity,
    input: z.infer<typeof createMaterial>,
  ): Promise<{ material_id: number; id: number }> {
    return this.db.transaction(async (client) => {
      const node = await this.sourceNode(actor, input.node_id, client);
      if (!input.mime_type.startsWith('text/'))
        await this.assertMedia(actor, input.content, input.mime_type, client);
      if (input.cover_image) await this.assertMedia(actor, input.cover_image, 'image/', client);
      const snapshot = {
        type: node.type,
        content: node.content,
        size:
          node.width == null || node.height == null
            ? null
            : { width: node.width, height: node.height },
        z_index: node.z_index,
        extra_data: node.extra_data,
      };
      const result = await client.query<{ id: number }>(
        `INSERT INTO materials(account_id,created_by,category,mime_type,material_name,content,cover_image,node_id,node_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          actor.accountId,
          actor.userId,
          input.category,
          input.mime_type,
          input.material_name,
          input.content,
          input.cover_image,
          input.node_id,
          snapshot,
        ],
      );
      return { material_id: result.rows[0].id, id: result.rows[0].id };
    });
  }

  /** 分页读取当前账号可见的素材。 */
  async materials(
    actor: Identity,
    input: ListQuery & { category?: string },
  ): Promise<{ list: MaterialRow[]; total: number }> {
    const shared = await this.canReadShared(actor);
    const users = this.userIds(input.users);
    const values = [actor.accountId, shared, actor.userId, input.category ?? null, users];
    const where = `account_id=$1 AND ($2::boolean OR created_by=$3)
      AND ($4::text IS NULL OR category=$4) AND ($5::int[] IS NULL OR created_by=ANY($5::int[]))`;
    const [rows, count] = await Promise.all([
      this.db.query<MaterialRow>(
        `SELECT id,id AS material_id,account_id,created_by AS user_id,created_by AS creator_id,
        category,mime_type,material_name,content,cover_image,node_id,node_data
        FROM materials WHERE ${where} ORDER BY id DESC LIMIT $6 OFFSET $7`,
        [...values, input.limit, (input.page - 1) * input.limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM materials WHERE ${where}`,
        values,
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 获取当前账号可见的单个素材和节点快照。 */
  async material(actor: Identity, materialId: number): Promise<MaterialRow> {
    const shared = await this.canReadShared(actor);
    const result = await this.db.query<MaterialRow>(
      `SELECT id,id AS material_id,account_id,created_by AS user_id,created_by AS creator_id,
       category,mime_type,material_name,content,cover_image,node_id,node_data
       FROM materials WHERE id=$1 AND account_id=$2 AND ($3::boolean OR created_by=$4)`,
      [materialId, actor.accountId, shared, actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '素材不存在');
    return result.rows[0];
  }

  /** 原子删除自己保存的素材；管理员可删除团队内全部素材。 */
  async deleteMaterials(actor: Identity, ids: number[]): Promise<{ deleted_ids: number[] }> {
    return this.deleteOwned(actor, 'materials', ids);
  }

  /** 主体使用的音色必须属于同一账号。 */
  private async assertTimbre(
    actor: Identity,
    timbreId: number,
    query: QueryExecutor,
  ): Promise<void> {
    if (!timbreId) return;
    const result = await query.query(
      'SELECT 1 FROM subject_timbres WHERE id=$1 AND account_id=$2',
      [timbreId, actor.accountId],
    );
    if (!result.rowCount) throw new AppError(404, '音色不存在');
  }

  /** 检查主体引用的所有图像或视频均已登记到当前账号。 */
  private async assertSubjectMedia(
    actor: Identity,
    input: z.infer<typeof subjectFields>,
    query: QueryExecutor,
  ): Promise<void> {
    const prefix = input.is_image ? 'image/' : 'video/';
    for (const url of input.content) await this.assertMedia(actor, url, prefix, query);
    await this.assertTimbre(actor, input.timbre_id, query);
  }

  /** 创建主体并保存媒体引用。 */
  async createSubject(
    actor: Identity,
    input: z.infer<typeof subjectFields>,
  ): Promise<{ subject_id: number; id: number }> {
    return this.db.transaction(async (client) => {
      await this.assertSubjectMedia(actor, input, client);
      const result = await client.query<{ id: number }>(
        `INSERT INTO subjects(account_id,created_by,category,subject_name,description,content,timbre_id,is_image)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          actor.accountId,
          actor.userId,
          input.category,
          input.subject_name,
          input.description,
          JSON.stringify(input.content),
          input.timbre_id || null,
          input.is_image,
        ],
      );
      return { subject_id: result.rows[0].id, id: result.rows[0].id };
    });
  }

  /** 更新当前账号内自己创建的主体。 */
  async updateSubject(
    actor: Identity,
    input: z.infer<typeof subjectFields> & { subject_id: number },
  ): Promise<{ subject_id: number; id: number }> {
    return this.db.transaction(async (client) => {
      await this.assertSubjectMedia(actor, input, client);
      const result = await client.query<{ id: number }>(
        `UPDATE subjects SET category=$1,subject_name=$2,description=$3,content=$4,timbre_id=$5,
         is_image=$6,updated_at=now() WHERE id=$7 AND account_id=$8
         AND ($9::boolean OR created_by=$10) RETURNING id`,
        [
          input.category,
          input.subject_name,
          input.description,
          JSON.stringify(input.content),
          input.timbre_id || null,
          input.is_image,
          input.subject_id,
          actor.accountId,
          actor.role !== 'member',
          actor.userId,
        ],
      );
      if (!result.rows[0]) throw new AppError(404, '主体不存在');
      return { subject_id: result.rows[0].id, id: result.rows[0].id };
    });
  }

  /** 分页读取团队共享或自己创建的主体。 */
  async subjects(
    actor: Identity,
    input: ListQuery & { type?: string },
  ): Promise<{ list: SubjectRow[]; total: number }> {
    const shared = await this.canReadShared(actor);
    const users = this.userIds(input.users);
    const values = [actor.accountId, shared, actor.userId, input.type ?? null, users];
    const where = `account_id=$1 AND ($2::boolean OR created_by=$3)
      AND ($4::text IS NULL OR category=$4) AND ($5::int[] IS NULL OR created_by=ANY($5::int[]))`;
    const select = `id AS subject_id,account_id,created_by AS user_id,created_by AS creator_id,
      category,subject_name,description,content,COALESCE(timbre_id,0) AS timbre_id,is_image,
      content->>0 AS cover_image`;
    const [rows, count] = await Promise.all([
      this.db.query<SubjectRow>(
        `SELECT ${select} FROM subjects WHERE ${where} ORDER BY id DESC LIMIT $6 OFFSET $7`,
        [...values, input.limit, (input.page - 1) * input.limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM subjects WHERE ${where}`,
        values,
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 读取主体详情，仅返回当前账号可见的数据。 */
  async subject(actor: Identity, subjectId: number): Promise<SubjectRow> {
    const shared = await this.canReadShared(actor);
    const result = await this.db.query<SubjectRow>(
      `SELECT id AS subject_id,account_id,created_by AS user_id,created_by AS creator_id,
       category,subject_name,description,content,COALESCE(timbre_id,0) AS timbre_id,is_image,
       content->>0 AS cover_image FROM subjects
       WHERE id=$1 AND account_id=$2 AND ($3::boolean OR created_by=$4)`,
      [subjectId, actor.accountId, shared, actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '主体不存在');
    return result.rows[0];
  }

  /** 删除一个或多个主体。 */
  async deleteSubjects(actor: Identity, ids: number[]): Promise<{ deleted_ids: number[] }> {
    return this.deleteOwned(actor, 'subjects', ids);
  }

  /** 返回当前账号下可见的自定义音色。 */
  async timbres(actor: Identity): Promise<{
    list: Array<{ timbre_id: number; timbre_name: string; audio_url: string; is_default: boolean }>;
  }> {
    const shared = await this.canReadShared(actor);
    const result = await this.db.query<{
      timbre_id: number;
      timbre_name: string;
      audio_url: string;
      is_default: boolean;
    }>(
      `SELECT id AS timbre_id,timbre_name,audio_url,false AS is_default FROM subject_timbres
       WHERE account_id=$1 AND ($2::boolean OR created_by=$3) ORDER BY id DESC`,
      [actor.accountId, shared, actor.userId],
    );
    return { list: result.rows };
  }

  /** 登记当前账号已有的音频作为自定义音色。 */
  async createTimbre(
    actor: Identity,
    input: z.infer<typeof createTimbre>,
  ): Promise<{ id: number; timbre_id: number }> {
    await this.assertMedia(actor, input.audio_url, 'audio/');
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO subject_timbres(account_id,created_by,timbre_name,audio_url) VALUES ($1,$2,$3,$4) RETURNING id`,
      [actor.accountId, actor.userId, input.timbre_name, input.audio_url],
    );
    return { id: result.rows[0].id, timbre_id: result.rows[0].id };
  }

  /** 删除自己创建的音色并解除主体引用。 */
  async deleteTimbre(actor: Identity, timbreId: number): Promise<{ timbre_id: number }> {
    const result = await this.db.query(
      `DELETE FROM subject_timbres WHERE id=$1 AND account_id=$2 AND ($3::boolean OR created_by=$4) RETURNING id`,
      [timbreId, actor.accountId, actor.role !== 'member', actor.userId],
    );
    if (!result.rowCount) throw new AppError(404, '音色不存在');
    return { timbre_id: timbreId };
  }

  /** 从当前画布节点创建或更新工具箱节点快照。 */
  async upsertNode(
    actor: Identity,
    input: z.infer<typeof upsertLibraryNode>,
  ): Promise<{ id: number }> {
    return this.db.transaction(async (client) => {
      const node = await this.sourceNode(actor, input.parent_node_id, client);
      if (input.cover_image) await this.assertMedia(actor, input.cover_image, 'image/', client);
      const category = ['video', 'image', 'audio', 'text'].includes(node.type)
        ? node.type
        : 'other';
      const snapshot = {
        type: node.type,
        content: node.content,
        extra_data: node.extra_data,
        size:
          node.width == null || node.height == null
            ? null
            : { width: node.width, height: node.height },
      };
      if (input.id) {
        const updated = await client.query<{ id: number }>(
          `UPDATE canvas_library_nodes SET parent_node_id=$1,title=$2,remark=$3,cover_image=$4,tags=$5,
           category=$6,node_data=$7,updated_at=now() WHERE id=$8 AND account_id=$9
           AND ($10::boolean OR created_by=$11) RETURNING id`,
          [
            input.parent_node_id,
            input.title,
            input.remark ?? '',
            input.cover_image ?? '',
            JSON.stringify(input.tags ?? []),
            category,
            snapshot,
            input.id,
            actor.accountId,
            actor.role !== 'member',
            actor.userId,
          ],
        );
        if (!updated.rows[0]) throw new AppError(404, '工具箱节点不存在');
        return { id: updated.rows[0].id };
      }
      const created = await client.query<{ id: number }>(
        `INSERT INTO canvas_library_nodes(account_id,created_by,parent_node_id,title,remark,cover_image,tags,category,node_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          actor.accountId,
          actor.userId,
          input.parent_node_id,
          input.title,
          input.remark ?? '',
          input.cover_image ?? '',
          JSON.stringify(input.tags ?? []),
          category,
          snapshot,
        ],
      );
      return { id: created.rows[0].id };
    });
  }

  /** 分页读取团队共享或自己创建的工具箱节点。 */
  async nodes(
    actor: Identity,
    input: ListQuery & { category?: string },
  ): Promise<{ list: LibraryNodeRow[]; total: number }> {
    const shared = await this.canReadShared(actor);
    const users = this.userIds(input.users);
    const values = [actor.accountId, shared, actor.userId, input.category ?? null, users];
    const where = `account_id=$1 AND ($2::boolean OR created_by=$3)
      AND ($4::text IS NULL OR category=$4) AND ($5::int[] IS NULL OR created_by=ANY($5::int[]))`;
    const select = `id,id AS canvas_node_id,account_id,created_by AS user_id,title,remark,
      cover_image,tags,parent_node_id,category,node_data`;
    const [rows, count] = await Promise.all([
      this.db.query<LibraryNodeRow>(
        `SELECT ${select} FROM canvas_library_nodes WHERE ${where} ORDER BY id DESC LIMIT $6 OFFSET $7`,
        [...values, input.limit, (input.page - 1) * input.limit],
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM canvas_library_nodes WHERE ${where}`,
        values,
      ),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 读取一个工具箱节点及其保存时的画布数据。 */
  async node(actor: Identity, nodeId: number): Promise<LibraryNodeRow> {
    const shared = await this.canReadShared(actor);
    const result = await this.db.query<LibraryNodeRow>(
      `SELECT id,id AS canvas_node_id,account_id,created_by AS user_id,title,remark,cover_image,
       tags,parent_node_id,category,node_data FROM canvas_library_nodes
       WHERE id=$1 AND account_id=$2 AND ($3::boolean OR created_by=$4)`,
      [nodeId, actor.accountId, shared, actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '工具箱节点不存在');
    return result.rows[0];
  }

  /** 删除一个或多个工具箱节点。 */
  async deleteNodes(actor: Identity, ids: number[]): Promise<{ deleted_ids: number[] }> {
    return this.deleteOwned(actor, 'canvas_library_nodes', ids);
  }

  /** 三类资源共用按账号和创建者限制的原子批量删除。 */
  private async deleteOwned(
    actor: Identity,
    table: 'materials' | 'subjects' | 'canvas_library_nodes',
    ids: number[],
  ): Promise<{ deleted_ids: number[] }> {
    if (new Set(ids).size !== ids.length) throw new AppError(400, '资源 ID 不得重复');
    return this.db.transaction(async (client) => {
      const removed = await client.query<{ id: number }>(
        `DELETE FROM ${table} WHERE id=ANY($1::int[]) AND account_id=$2
         AND ($3::boolean OR created_by=$4) RETURNING id`,
        [ids, actor.accountId, actor.role !== 'member', actor.userId],
      );
      if (removed.rows.length !== ids.length) throw new AppError(404, '资源不存在');
      return { deleted_ids: ids };
    });
  }
}
