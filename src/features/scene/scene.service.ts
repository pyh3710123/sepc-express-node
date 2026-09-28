import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';
import { PermissionsService } from '../permissions/permissions.service';
import type { SceneInput, SceneName } from './scene.schemas';

@Injectable()
export class SceneService {
  /** 旧场景生成端点在价格和供应商配置前，仅验证所有权并明确拒绝执行。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  /** 校验节点与媒体都属于项目，再报告当前无法安全受理付费任务。 */
  async unavailable(actor: Identity, scene: SceneName, input: SceneInput): Promise<never> {
    await this.permissions.assertProject(actor, 'drama', input.drama_id, 'generate');
    if (input.node_id) {
      const node = await this.db.query<{ canvas_id: number }>(
        `SELECT n.canvas_id FROM nodes n JOIN canvases c ON c.id=n.canvas_id
         JOIN dramas d ON d.id=c.drama_id AND d.deleted_at IS NULL
         WHERE n.id=$1 AND d.id=$2 AND c.account_id=$3`,
        [input.node_id, input.drama_id, actor.accountId],
      );
      if (!node.rows[0] || (input.canvas_id && input.canvas_id !== node.rows[0].canvas_id))
        throw new AppError(404, '节点不存在');
    }
    for (const url of [input.image, input.video, input.mask_image, input.reference_image]) {
      if (!url) continue;
      const asset = await this.db.query(
        `SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2
         UNION ALL SELECT 1 FROM public_media_assets WHERE published AND url=$2 LIMIT 1`,
        [actor.accountId, url],
      );
      if (!asset.rowCount) throw new AppError(404, '媒体资产不存在');
    }
    throw new AppError(503, `${scene} 供应商与价格未配置`);
  }

  /** 读取后台已发布的打光预设；未发布项不进入创作选择器。 */
  async presets(): Promise<{ list: unknown[] }> {
    const result = await this.db.query(
      `SELECT id,preset_name,cover_image,show_prompt,reference_image,
       brightness::float8 AS brightness,color_hex,point_key
       FROM lighten_presets WHERE published ORDER BY sort_order,id`,
    );
    return { list: result.rows };
  }
}
