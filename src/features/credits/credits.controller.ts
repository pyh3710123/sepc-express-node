import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { CreditsService } from './credits.service';

@Controller('api')
export class CreditsController {
  /** 注入积分服务，处理余额与流水请求。 */
  constructor(@Inject(CreditsService) private readonly credits: CreditsService) {}

  /** 返回当前账号的积分余额及关联方案信息。 */
  @Get('credit')
  @UseGuards(AuthGuard)
  credit(@Req() request: AuthedRequest): ReturnType<CreditsService['balance']> {
    return this.credits.balance(request.auth);
  }

  /** 按分页参数返回当前账号的积分流水。 */
  @Get('credit/bill')
  @UseGuards(AuthGuard)
  bills(
    @Req() request: AuthedRequest,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
  ): ReturnType<CreditsService['bills']> {
    const pagination = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      { page, limit },
    );
    return this.credits.bills(request.auth, pagination.page, pagination.limit);
  }
}
