import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, AuthService, type AuthedRequest } from '../auth';
import { AccountsService } from './accounts.service';

const idSchema = z.coerce.number().int().positive();

@Controller('api')
export class AccountsController {
  /** 注入账号与认证服务，处理账号信息和切换请求。 */
  constructor(
    @Inject(AccountsService) private readonly accountsService: AccountsService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  /** 返回当前用户及所选账号的首页身份信息。 */
  @Get('user/info')
  @UseGuards(AuthGuard)
  info(@Req() request: AuthedRequest): ReturnType<AccountsService['info']> {
    return this.accountsService.info(request.auth);
  }

  /** 列出当前用户可访问的账号。 */
  @Get('account')
  @UseGuards(AuthGuard)
  accounts(@Req() request: AuthedRequest): ReturnType<AccountsService['list']> {
    return this.accountsService.list(request.auth);
  }

  /** 校验目标账号成员关系后切换当前会话。 */
  @Post('account/change')
  @UseGuards(AuthGuard)
  changeAccount(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AuthService['changeAccount']> {
    const input = parse(z.object({ account_id: idSchema }), body);
    return this.authService.changeAccount(request.auth, input.account_id);
  }
}
