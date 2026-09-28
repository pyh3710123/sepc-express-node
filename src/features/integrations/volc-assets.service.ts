import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common';
import { Database } from '../../database';
import type { Identity } from '../auth';

@Injectable()
export class VolcAssetsService {
  /** 火山素材记录按账号隔离，提交与实时状态依赖未配置的供应商。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 校验待提交素材归属和类型后报告外部服务不可用。 */
  async submit(
    actor: Identity,
    url: string,
    assetType: 'Image' | 'Video' | 'Audio',
  ): Promise<never> {
    const mime = assetType.toLowerCase();
    const asset = await this.db.query(
      `SELECT 1 FROM media_assets WHERE account_id=$1 AND url=$2 AND mime_type LIKE $3 LIMIT 1`,
      [actor.accountId, url, `${mime}/%`],
    );
    if (!asset.rowCount) throw new AppError(404, '媒体资产不存在');
    throw new AppError(503, '火山素材审核服务未配置');
  }

  /** 只允许读取本账号已有的审核记录；实时同步不可用时不返回可能过期的状态。 */
  async detail(actor: Identity, id: number): Promise<never> {
    const record = await this.db.query(
      'SELECT 1 FROM volc_asset_records WHERE id=$1 AND account_id=$2',
      [id, actor.accountId],
    );
    if (!record.rowCount) throw new AppError(404, '火山素材记录不存在');
    throw new AppError(503, '火山素材状态同步服务未配置');
  }
}
