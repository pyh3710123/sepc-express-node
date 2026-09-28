import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, AuthService, type AuthedRequest } from '../auth';
import { OpusesService } from './opuses.service';
import {
  opusAwardPage,
  opusId,
  opusMinePage,
  opusPage,
  opusRecommendPage,
  publishOpus,
} from './opuses.schemas';

@Controller('api/opus')
export class OpusesController {
  /** 作品公开查询和当前用户写入共用媒体归属服务。 */
  constructor(
    @Inject(OpusesService) private readonly opuses: OpusesService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** 可发布的作品类型。 */
  @Get('type') types(): ReturnType<OpusesService['types']> {
    return this.opuses.types();
  }
  /** 发布或编辑当前账号作品。 */
  @Post()
  @UseGuards(AuthGuard)
  publish(@Req() r: AuthedRequest, @Body() b: unknown): ReturnType<OpusesService['publish']> {
    return this.opuses.publish(r.auth, parse(publishOpus, b));
  }
  /** 查询本人或当前账号管理员可管理的作品。 */
  @Get()
  @UseGuards(AuthGuard)
  mine(@Req() r: AuthedRequest, @Query() q: unknown): ReturnType<OpusesService['mine']> {
    const input = parse(opusMinePage, q);
    return this.opuses.mine(r.auth, input.page, input.limit, input.is_activity);
  }
  /** 收藏作品列表。 */
  @Get('collection')
  @UseGuards(AuthGuard)
  collections(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<OpusesService['collections']> {
    const input = parse(opusPage, q);
    return this.opuses.collections(r.auth, input.page, input.limit);
  }
  /** 公开推荐作品列表。 */
  @Get('recommend') recommended(@Query() q: unknown): ReturnType<OpusesService['recommended']> {
    const input = parse(opusRecommendPage, q);
    return this.opuses.recommended(input.page, input.limit, input.type_id, input.name);
  }
  /** 活动获奖作品列表。 */
  @Get('award') award(@Query() q: unknown): ReturnType<OpusesService['recommended']> {
    const input = parse(opusAwardPage, q);
    return this.opuses.recommended(
      input.page,
      input.limit,
      undefined,
      undefined,
      input.activity_id,
    );
  }
  /** 克隆允许复用的公开作品。 */
  @Post('clone')
  @UseGuards(AuthGuard)
  clone(@Req() r: AuthedRequest, @Body() b: unknown): ReturnType<OpusesService['clone']> {
    return this.opuses.clone(r.auth, parse(z.object({ opus_id: opusId }).strict(), b).opus_id);
  }
  /** 设置作品收藏状态。 */
  @Put('collection/:id')
  @UseGuards(AuthGuard)
  collect(
    @Req() r: AuthedRequest,
    @Param('id') id: unknown,
    @Body() b: unknown,
  ): ReturnType<OpusesService['collect']> {
    return this.opuses.collect(
      r.auth,
      parse(opusId, id),
      parse(z.object({ action: z.boolean() }).strict(), b).action,
    );
  }
  /** 公开详情可匿名查看，已登录时计算本人收藏状态。 */
  @Get('recommend/:id')
  async publicDetail(
    @Req() r: { headers: { authorization?: string } },
    @Param('id') id: unknown,
  ): ReturnType<OpusesService['publicDetail']> {
    const bearer = r.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const userId = bearer ? (await this.auth.authenticate(bearer)).userId : undefined;
    return this.opuses.publicDetail(parse(opusId, id), userId);
  }
  /** 热度作品列表只使用公开作品。 */
  @Get('top/:id') top(@Param('id') id: unknown): ReturnType<OpusesService['top']> {
    return this.opuses.top(parse(opusId, id));
  }
  /** 可克隆作品的已发布画布过程。 */
  @Get('process/:id') process(@Param('id') id: unknown): ReturnType<OpusesService['process']> {
    return this.opuses.process(parse(opusId, id));
  }
  /** 当前账号管理作品的编辑详情。 */
  @Get(':id')
  @UseGuards(AuthGuard)
  ownDetail(
    @Req() r: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<OpusesService['ownDetail']> {
    return this.opuses.ownDetail(r.auth, parse(opusId, id));
  }
  /** 所有者或管理员删除作品。 */
  @Delete(':id')
  @UseGuards(AuthGuard)
  delete(@Req() r: AuthedRequest, @Param('id') id: unknown): ReturnType<OpusesService['delete']> {
    return this.opuses.delete(r.auth, parse(opusId, id));
  }
}
