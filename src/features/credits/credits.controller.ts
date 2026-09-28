import { Body, Controller, Get, Inject, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
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

  /** 管理员批量保存团队成员月度积分额度。 */
  @Post('credit/allocate')
  @UseGuards(AuthGuard)
  allocate(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<CreditsService['allocate']> {
    const input = parse(
      z
        .object({
          allocation: z
            .array(
              z
                .object({
                  user_id: z.coerce.number().int().positive(),
                  credit_quota: z.number().int().min(-1).max(99999999999),
                })
                .strict(),
            )
            .min(1)
            .max(500),
        })
        .strict(),
      body,
    );
    return this.credits.allocate(request.auth, input.allocation);
  }

  /** 查询积分来源扣费顺序。 */
  @Get('credit/priority')
  @UseGuards(AuthGuard)
  priority(@Req() request: AuthedRequest): ReturnType<CreditsService['priority']> {
    return this.credits.priority(request.auth);
  }

  /** 保存账号级积分来源扣费顺序。 */
  @Put('credit/priority')
  @UseGuards(AuthGuard)
  setPriority(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<CreditsService['setPriority']> {
    const input = parse(z.object({ priority: z.array(z.number().int()).length(3) }).strict(), body);
    return this.credits.setPriority(request.auth, input.priority);
  }

  /** 恢复账号默认积分来源扣费顺序。 */
  @Post('credit/priority')
  @UseGuards(AuthGuard)
  resetPriority(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<CreditsService['resetPriority']> {
    parse(z.object({}).strict(), body);
    return this.credits.resetPriority(request.auth);
  }
}
