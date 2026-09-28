import { Body, Controller, Delete, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { AssetsService } from './assets.service';
import { assetHistoryQuery, assetQuery, deleteAssets } from './assets.schemas';

@Controller('api')
@UseGuards(AuthGuard)
export class AssetsController {
  /** 资产列表和历史共用账号归属校验。 */
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}

  /** 按媒体与创建日期返回可见资产。 */
  @Get('asset') list(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<AssetsService['list']> {
    return this.assets.list(request.auth, parse(assetQuery, query));
  }

  /** 查询生成历史所需的已登记媒体。 */
  @Get('asset/history') history(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<AssetsService['history']> {
    return this.assets.history(request.auth, parse(assetHistoryQuery, query));
  }

  /** 删除当前账号无引用的资产登记。 */
  @Delete('asset') delete(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AssetsService['delete']> {
    return this.assets.delete(request.auth, parse(deleteAssets, body).ids);
  }
}
