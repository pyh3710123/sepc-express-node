import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';

@Injectable()
export class CameraService {
  /** 运镜预设以账号归属保存；系统预设只读，收藏按用户隔离。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 查询系统广场、个人收藏或本人创建的运镜。 */
  async list(
    actor: Identity,
    queryType: 1 | 2 | 3,
    name?: string,
  ): Promise<{ list: unknown[]; total: number }> {
    const result = await this.db.query(
      `SELECT c.id,c.title,c.prompt_text,c.preview_image,c.account_id IS NULL AS is_system,
       EXISTS(SELECT 1 FROM camera_collections cc WHERE cc.camera_id=c.id AND cc.user_id=$1) AS is_collected
       FROM camera_motions c WHERE
       (($2::int=1 AND c.account_id IS NULL) OR
        ($2::int=2 AND EXISTS(SELECT 1 FROM camera_collections cc WHERE cc.camera_id=c.id AND cc.user_id=$1)
           AND (c.account_id IS NULL OR (c.account_id=$3 AND c.created_by=$1))) OR
        ($2::int=3 AND c.account_id=$3 AND c.created_by=$1))
       AND ($4::text IS NULL OR c.title ILIKE '%' || $4 || '%') ORDER BY c.id DESC LIMIT 100`,
      [actor.userId, queryType, actor.accountId, name ?? null],
    );
    return { list: result.rows, total: result.rows.length };
  }

  /** 创建或更新本人运镜，封面只能引用当前账号已登记的媒体。 */
  async save(
    actor: Identity,
    input: { id?: number; title: string; prompt_text?: string; preview_image?: string },
  ): Promise<unknown> {
    if (input.preview_image) {
      const image = await this.db.query(
        'SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3',
        [actor.accountId, input.preview_image, 'image/%'],
      );
      if (!image.rowCount) throw new AppError(404, '预览图片不存在');
    }
    if (input.id) {
      const result = await this.db.query(
        `UPDATE camera_motions SET title=$1,prompt_text=$2,preview_image=$3,updated_at=now()
         WHERE id=$4 AND account_id=$5 AND created_by=$6 RETURNING id,title,prompt_text,preview_image`,
        [
          input.title,
          input.prompt_text ?? '',
          input.preview_image ?? '',
          input.id,
          actor.accountId,
          actor.userId,
        ],
      );
      if (!result.rows[0]) throw new AppError(404, '运镜不存在');
      return result.rows[0];
    }
    const result = await this.db.query(
      `INSERT INTO camera_motions(account_id,created_by,title,prompt_text,preview_image)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,title,prompt_text,preview_image`,
      [
        actor.accountId,
        actor.userId,
        input.title,
        input.prompt_text ?? '',
        input.preview_image ?? '',
      ],
    );
    return result.rows[0];
  }

  /** 幂等设置收藏状态，只能收藏系统或本人可见的运镜。 */
  async collect(
    actor: Identity,
    id: number,
    collected: boolean,
  ): Promise<{ id: number; is_collected: boolean }> {
    const camera = await this.db.query(
      `SELECT 1 FROM camera_motions WHERE id=$1 AND (account_id IS NULL OR (account_id=$2 AND created_by=$3))`,
      [id, actor.accountId, actor.userId],
    );
    if (!camera.rowCount) throw new AppError(404, '运镜不存在');
    if (collected)
      await this.db.query(
        'INSERT INTO camera_collections(user_id,camera_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [actor.userId, id],
      );
    else
      await this.db.query('DELETE FROM camera_collections WHERE user_id=$1 AND camera_id=$2', [
        actor.userId,
        id,
      ]);
    return { id, is_collected: collected };
  }

  /** 删除本人创建的运镜，系统和其他成员记录不可删除。 */
  async delete(actor: Identity, id: number): Promise<{ id: number }> {
    const result = await this.db.query(
      'DELETE FROM camera_motions WHERE id=$1 AND account_id=$2 AND created_by=$3 RETURNING id',
      [id, actor.accountId, actor.userId],
    );
    if (!result.rows[0]) throw new AppError(404, '运镜不存在');
    return { id };
  }
}
