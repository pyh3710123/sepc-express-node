import { Body, Controller, Delete, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { CameraService } from './camera.service';

const id = z.coerce.number().int().positive();
const listQuery = z
  .object({
    query_type: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2), z.literal(3)])),
    name: z.string().trim().max(100).optional(),
  })
  .strict();
const saveBody = z
  .object({
    id: id.optional(),
    title: z.string().trim().min(1).max(100),
    prompt_text: z.string().max(5000).optional(),
    preview_image: z.string().max(2048).optional(),
  })
  .strict();

@Controller('api/camera')
@UseGuards(AuthGuard)
export class CameraController {
  /** 运镜列表、个人编辑和收藏入口。 */
  constructor(@Inject(CameraService) private readonly cameras: CameraService) {}

  /** 按广场、收藏和个人分类读取运镜。 */
  @Get() list(@Req() r: AuthedRequest, @Query() q: unknown): ReturnType<CameraService['list']> {
    const input = parse(listQuery, q);
    return this.cameras.list(r.auth, input.query_type, input.name);
  }

  /** 创建或更新个人运镜。 */
  @Post() save(@Req() r: AuthedRequest, @Body() b: unknown): ReturnType<CameraService['save']> {
    return this.cameras.save(r.auth, parse(saveBody, b));
  }

  /** 设置运镜收藏状态。 */
  @Post('collect') collect(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<CameraService['collect']> {
    const input = parse(z.object({ id, collect: z.boolean() }).strict(), b);
    return this.cameras.collect(r.auth, input.id, input.collect);
  }

  /** 删除个人运镜。 */
  @Delete() delete(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<CameraService['delete']> {
    return this.cameras.delete(r.auth, parse(z.object({ id }).strict(), b).id);
  }
}
