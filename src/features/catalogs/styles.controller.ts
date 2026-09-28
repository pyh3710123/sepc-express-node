import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { StylesService } from './styles.service';

const id = z.coerce.number().int().positive();
const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    name: z.string().trim().max(100).optional(),
    keywords: z.string().trim().max(100).optional(),
    model_id: z.coerce.string().trim().min(1).max(100).optional(),
    type_id: id.optional(),
    is_recommend: z.coerce
      .number()
      .pipe(z.union([z.literal(0), z.literal(1)]))
      .optional(),
    can_commercial: z.coerce
      .number()
      .pipe(z.union([z.literal(0), z.literal(1)]))
      .optional(),
  })
  .strict();

@Controller('api')
@UseGuards(AuthGuard)
export class StylesController {
  /** 风格广场、收藏和使用记录共用目录服务。 */
  constructor(@Inject(StylesService) private readonly styles: StylesService) {}

  /** 返回已发布的官方图片场景预设。 */
  @Get('drama/canvas/image/scene') scenePresets(): ReturnType<StylesService['scenePresets']> {
    return this.styles.scenePresets();
  }
  /** 风格分类。 */
  @Get('image/style/category') categories(): ReturnType<StylesService['categories']> {
    return this.styles.categories();
  }
  /** 风格广场。 */
  @Get('image/style') list(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<StylesService['list']> {
    return this.styles.list(r.auth, 'all', parse(listQuery, q));
  }
  /** 收藏风格。 */
  @Get('image/style/collection') collections(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<StylesService['list']> {
    return this.styles.list(r.auth, 'collection', parse(listQuery, q));
  }
  /** 最近使用风格。 */
  @Get('image/style/recent') recent(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<StylesService['list']> {
    return this.styles.list(r.auth, 'recent', parse(listQuery, q));
  }
  /** 切换收藏。 */
  @Post('image/style/collect') collect(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<StylesService['toggleCollection']> {
    return this.styles.toggleCollection(
      r.auth,
      parse(z.object({ style_id: id }).strict(), b).style_id,
    );
  }
  /** 保存一次实际选用。 */
  @Post('image/style/use') use(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<StylesService['use']> {
    return this.styles.use(r.auth, parse(z.object({ style_id: id }).strict(), b).style_id);
  }
}
