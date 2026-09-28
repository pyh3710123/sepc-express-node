import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard } from '../auth';
import { PromptsService } from './prompts.service';

const promptQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().trim().max(100).optional(),
    prompt_type: z.string().trim().min(1).max(100).optional(),
    model_id: z.coerce.string().trim().min(1).max(100).optional(),
  })
  .strict();

@Controller('api/prompt')
@UseGuards(AuthGuard)
export class PromptsController {
  /** 提示词与模型分类均查询同一持久目录。 */
  constructor(@Inject(PromptsService) private readonly prompts: PromptsService) {}

  /** 按生成类型、模型和关键词搜索示例。 */
  @Get() list(@Query() query: unknown): ReturnType<PromptsService['list']> {
    return this.prompts.list(parse(promptQuery, query));
  }

  /** 返回目录中确有模板的模型分类。 */
  @Get('model') models(): ReturnType<PromptsService['models']> {
    return this.prompts.models();
  }
}
