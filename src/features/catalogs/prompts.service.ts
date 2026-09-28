import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../database';

@Injectable()
export class PromptsService {
  /** 提示词示例从持久目录读取，模型分类与同一目录保持一致。 */
  constructor(@Inject(Database) private readonly db: Database) {}

  /** 分页搜索提示词目录，返回可用于画布落点的能力信息。 */
  async list(input: {
    page: number;
    limit: number;
    keyword?: string;
    prompt_type?: string;
    model_id?: string;
  }): Promise<unknown> {
    const params = [
      input.keyword ?? null,
      input.prompt_type ?? null,
      input.model_id ?? null,
      input.limit,
      (input.page - 1) * input.limit,
    ];
    const filter = `($1::text IS NULL OR p.prompt_text ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR p.prompt_type=$2)
       AND ($3::text IS NULL OR m.model_id::text=$3)`;
    const [list, total] = await Promise.all([
      this.db.query(
        `SELECT p.id AS prompt_id,m.model_id,m.model_name,p.capability_id,
         c.mode_type AS generate_mode,p.prompt_type,p.prompt_text,p.resource_url,
         (p.resource_url<>'') AS use_resource,p.default_params,p.content_resource
         FROM prompt_templates p LEFT JOIN model_catalog m ON m.model_code=p.model_code
         LEFT JOIN model_capabilities c ON c.capability_id=p.capability_id
         WHERE ${filter} ORDER BY p.id DESC LIMIT $4 OFFSET $5`,
        params,
      ),
      this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM prompt_templates p LEFT JOIN model_catalog m ON m.model_code=p.model_code WHERE ${filter}`,
        params.slice(0, 3),
      ),
    ]);
    return { list: list.rows, total: total.rows[0].total };
  }

  /** 只返回确有提示词模板的模型，避免显示无法使用的空分类。 */
  async models(): Promise<unknown> {
    const result = await this.db.query(
      `SELECT DISTINCT m.model_id,m.model_name FROM prompt_templates p
       JOIN model_catalog m ON m.model_code=p.model_code WHERE m.active ORDER BY m.model_name`,
    );
    return { list: result.rows };
  }
}
