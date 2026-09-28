import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { VolcAssetsService } from './volc-assets.service';

const assetId = z.coerce.number().int().positive();
const submit = z
  .object({
    url: z.string().trim().min(1).max(2048),
    asset_type: z.enum(['Image', 'Video', 'Audio']),
  })
  .strict();

@Controller('api/volc-asset')
@UseGuards(AuthGuard)
export class VolcAssetsController {
  /** 审核接口在供应商未接入时不创建假记录。 */
  constructor(@Inject(VolcAssetsService) private readonly assets: VolcAssetsService) {}

  /** 提交当前账号已登记的媒体审核。 */
  @Post() submit(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<VolcAssetsService['submit']> {
    const input = parse(submit, b);
    return this.assets.submit(r.auth, input.url, input.asset_type);
  }

  /** 查询当前账号已有审核记录的最新状态。 */
  @Get(':id') detail(
    @Req() r: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<VolcAssetsService['detail']> {
    return this.assets.detail(r.auth, parse(assetId, id));
  }
}
