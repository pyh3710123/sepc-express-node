import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';

export interface StyleQuery {
  page: number;
  limit: number;
  name?: string;
  keywords?: string;
  model_id?: string;
  type_id?: number;
  is_recommend?: 0 | 1;
  can_commercial?: 0 | 1;
}

@Injectable()
export class StylesService {
  /** 官方风格目录、用户收藏和最近使用记录均由数据库保存。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 返回风格分类及推荐标记。 */
  async categories(): Promise<{ list: unknown[] }> {
    const result = await this.db.query(
      'SELECT id,id AS type_id,name,is_recommend FROM image_style_categories ORDER BY id',
    );
    return { list: result.rows };
  }

  /** 分页查询风格广场、收藏或最近使用，查询条件在数据库中生效。 */
  async list(
    actor: Identity,
    kind: 'all' | 'collection' | 'recent',
    input: StyleQuery,
  ): Promise<{ list: unknown[]; total: number }> {
    const params = [
      actor.userId,
      input.name ?? null,
      input.keywords ?? null,
      input.model_id ?? null,
      input.type_id ?? null,
      input.is_recommend ?? null,
      input.can_commercial ?? null,
      input.limit,
      (input.page - 1) * input.limit,
    ];
    const filter = `($2::text IS NULL OR s.name ILIKE '%' || $2 || '%')
       AND ($3::text IS NULL OR (s.name || ' ' || s.author_name) ILIKE '%' || $3 || '%')
       AND ($4::text IS NULL OR s.support_models ? COALESCE((SELECT model_code FROM model_catalog WHERE model_id::text=$4),$4))
       AND ($5::int IS NULL OR s.category_id=$5)
       AND ($6::int IS NULL OR s.is_recommend=($6=1))
       AND ($7::int IS NULL OR s.can_commercial=($7=1))
       AND (${'collection' === kind ? 'cl.user_id IS NOT NULL' : kind === 'recent' ? 'u.user_id IS NOT NULL' : 'true'})`;
    const from = `FROM image_styles s LEFT JOIN image_style_collections cl ON cl.style_id=s.id AND cl.user_id=$1
      LEFT JOIN image_style_uses u ON u.style_id=s.id AND u.user_id=$1 WHERE ${filter}`;
    const order = kind === 'recent' ? 'u.last_used_at DESC,s.id DESC' : 's.id DESC';
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT s.id,s.id AS style_id,s.name,s.name AS style_name,s.cover_image,s.author_name,
         s.category_id AS type_id,s.support_models,s.can_commercial,s.is_recommend,
         cl.user_id IS NOT NULL AS is_collected,COALESCE(u.use_count,0) AS use_count
         ${from} ORDER BY ${order} LIMIT $8 OFFSET $9`,
        params,
      ),
      this.db.query<{ total: number }>(`SELECT count(*)::int AS total ${from}`, params.slice(0, 7)),
    ]);
    return { list: rows.rows, total: count.rows[0].total };
  }

  /** 按当前用户状态切换收藏，风格 ID 必须存在于目录。 */
  async toggleCollection(
    actor: Identity,
    styleId: number,
  ): Promise<{ style_id: number; is_collected: boolean }> {
    return this.db.transaction(async (client) => {
      const style = await client.query('SELECT 1 FROM image_styles WHERE id=$1', [styleId]);
      if (!style.rowCount) throw new AppError(404, '风格不存在');
      const removed = await client.query(
        'DELETE FROM image_style_collections WHERE user_id=$1 AND style_id=$2 RETURNING style_id',
        [actor.userId, styleId],
      );
      if (removed.rowCount) return { style_id: styleId, is_collected: false };
      await client.query(
        'INSERT INTO image_style_collections(user_id,style_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [actor.userId, styleId],
      );
      return { style_id: styleId, is_collected: true };
    });
  }

  /** 记录真实选用次数及时间，供最近使用列表读取。 */
  async use(actor: Identity, styleId: number): Promise<{ style_id: number }> {
    const result = await this.db.query(
      `INSERT INTO image_style_uses(user_id,style_id) SELECT $1,id FROM image_styles WHERE id=$2
       ON CONFLICT (user_id,style_id) DO UPDATE SET use_count=image_style_uses.use_count+1,last_used_at=now()
       RETURNING style_id`,
      [actor.userId, styleId],
    );
    if (!result.rows[0]) throw new AppError(404, '风格不存在');
    return { style_id: styleId };
  }

  /** 按分类读取后台已发布的图片场景预设和模型白名单。 */
  async scenePresets(): Promise<{ list: Array<{ title: string; list: unknown[] }> }> {
    const result = await this.db.query<{
      category_id: number;
      title: string;
      key: string | null;
      name: string | null;
      desc: string | null;
      allow_model: unknown[] | null;
      icon: Record<string, unknown> | null;
    }>(
      `SELECT c.id AS category_id,c.title,p.key,p.name,p.description AS "desc",p.allow_model,p.icon
       FROM image_scene_preset_categories c LEFT JOIN image_scene_presets p
         ON p.category_id=c.id AND p.published
       WHERE c.published ORDER BY c.sort_order,c.id,p.sort_order,p.id`,
    );
    const categories = new Map<number, { title: string; list: unknown[] }>();
    for (const row of result.rows) {
      let category = categories.get(row.category_id);
      if (!category) {
        category = { title: row.title, list: [] };
        categories.set(row.category_id, category);
      }
      if (row.key)
        category.list.push({
          key: row.key,
          name: row.name,
          desc: row.desc,
          allow_model: row.allow_model,
          icon: row.icon,
        });
    }
    return { list: [...categories.values()] };
  }
}
