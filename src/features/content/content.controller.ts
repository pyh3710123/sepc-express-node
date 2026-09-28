import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { ContentService } from './content.service';

const id = z.coerce.number().int().positive();
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    type: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])),
    unread: z.enum(['true', 'false']).optional(),
  })
  .strict();

@Controller('api')
export class ContentController {
  /** 注入通知与文章目录服务。 */
  constructor(@Inject(ContentService) private readonly content: ContentService) {}

  /** 公开读取已发布文章。 */
  @Get('article/detail') article(@Query() query: unknown): ReturnType<ContentService['article']> {
    return this.content.article(
      parse(z.object({ code: z.string().trim().min(1).max(100) }).strict(), query).code,
    );
  }

  /** 按当前身份列出可见通知。 */
  @Get('notification')
  @UseGuards(AuthGuard)
  notifications(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<ContentService['notifications']> {
    const input = parse(listQuery, q);
    return this.content.notifications(r.auth, { ...input, unread: input.unread === 'false' });
  }

  /** 读取并标记当前用户通知为已读。 */
  @Get('notification/:id')
  @UseGuards(AuthGuard)
  notification(
    @Req() r: AuthedRequest,
    @Param('id') value: unknown,
  ): ReturnType<ContentService['notification']> {
    return this.content.notification(r.auth, parse(id, value));
  }
}
