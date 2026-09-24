import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config';
import { Database } from '../../database';

interface CarouselItem extends QueryResultRow {
  id: number;
  title: string;
  image_url: string;
  link_url: string | null;
}

@Injectable()
export class HomeService {
  /** 注入数据库与外部模型开关，提供首页所需数据。 */
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** 根据开发模拟配置和已启用模型能力返回首页初始化状态。 */
  async init(): Promise<{ model_enabled: boolean }> {
    if (!this.config.devMockExternals) return { model_enabled: false };
    const result = await this.db.query(
      `SELECT 1 FROM model_capabilities c
       JOIN model_catalog m ON m.model_code=c.model_code
       WHERE c.active AND m.active AND m.provider='mock' LIMIT 1`,
    );
    return { model_enabled: result.rowCount !== 0 };
  }

  /** 查询当前生效的轮播内容及总数。 */
  async carousel(): Promise<{ list: CarouselItem[]; total: number }> {
    const [items, count] = await Promise.all([
      this.db.query<CarouselItem>(
        `SELECT id,title,image_url,link_url FROM home_carousels
         WHERE published AND (starts_at IS NULL OR starts_at<=now())
           AND (ends_at IS NULL OR ends_at>now())
         ORDER BY sort_order,id LIMIT 20`,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM home_carousels
         WHERE published AND (starts_at IS NULL OR starts_at<=now())
           AND (ends_at IS NULL OR ends_at>now())`,
      ),
    ]);
    return { list: items.rows, total: count.rows[0].total };
  }
}
