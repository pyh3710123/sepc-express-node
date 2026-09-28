import { Body, Controller, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, AuthService, type AuthedRequest } from '../auth';
import { AccountsService } from './accounts.service';

const idSchema = z.coerce.number().int().positive();
const teamSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    intro: z.string().trim().max(500).default(''),
  })
  .strict();
const teamUpdateSchema = teamSchema
  .partial()
  .refine((value) => value.name !== undefined || value.intro !== undefined);
const memberTargetSchema = z.object({ target_uid: idSchema }).strict();
const profileSchema = z
  .object({
    nickname: z.string().trim().min(1).max(100).optional(),
    avatar: z.string().trim().min(1).max(2048).nullable().optional(),
  })
  .strict()
  .refine((value) => value.nickname !== undefined || value.avatar !== undefined);

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

  /** 更新当前用户的个人展示资料。 */
  @Put('user/info')
  @UseGuards(AuthGuard)
  updateProfile(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AccountsService['updateProfile']> {
    return this.accountsService.updateProfile(request.auth, parse(profileSchema, body));
  }

  /** 查询当前账号去水印设置。 */
  @Get('account/watermark')
  @UseGuards(AuthGuard)
  watermark(@Req() request: AuthedRequest): ReturnType<AccountsService['watermark']> {
    return this.accountsService.watermark(request.auth);
  }

  /** 修改当前账号去水印设置。 */
  @Post('account/watermark')
  @UseGuards(AuthGuard)
  updateWatermark(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AccountsService['updateWatermark']> {
    return this.accountsService.updateWatermark(
      request.auth,
      parse(z.object({ watermark: z.boolean() }).strict(), body).watermark,
    );
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

  /** 创建团队账号。 */
  @Post('account')
  @UseGuards(AuthGuard)
  createTeam(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AccountsService['createTeam']> {
    return this.accountsService.createTeam(request.auth, parse(teamSchema, body));
  }

  /** 列出当前团队成员。 */
  @Get('account/member')
  @UseGuards(AuthGuard)
  members(@Req() request: AuthedRequest): ReturnType<AccountsService['members']> {
    return this.accountsService.members(request.auth);
  }

  /** 列出成员选择项。 */
  @Get('account/member/select')
  @UseGuards(AuthGuard)
  memberSelect(@Req() request: AuthedRequest): ReturnType<AccountsService['memberSelect']> {
    return this.accountsService.memberSelect(request.auth);
  }

  /** 移除成员并撤销其会话。 */
  @Post('account/remove')
  @UseGuards(AuthGuard)
  removeMember(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AccountsService['removeMember']> {
    const input = parse(memberTargetSchema, body);
    return this.accountsService.removeMember(request.auth, input.target_uid);
  }

  /** 转移管理员身份。 */
  @Post('account/transfer')
  @UseGuards(AuthGuard)
  transferAdmin(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<AccountsService['transferAdmin']> {
    const input = parse(memberTargetSchema, body);
    return this.accountsService.transferAdmin(request.auth, input.target_uid);
  }

  /** 退出当前团队。 */
  @Post('account/quit')
  @UseGuards(AuthGuard)
  quitTeam(@Req() request: AuthedRequest): ReturnType<AccountsService['quitTeam']> {
    return this.accountsService.quitTeam(request.auth);
  }

  /** 解散当前团队。 */
  @Post('account/dissolve')
  @UseGuards(AuthGuard)
  dissolveTeam(@Req() request: AuthedRequest): ReturnType<AccountsService['dissolveTeam']> {
    return this.accountsService.dissolveTeam(request.auth);
  }

  /** 读取当前团队资料。 */
  @Get('account/:id')
  @UseGuards(AuthGuard)
  team(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<AccountsService['team']> {
    return this.accountsService.team(request.auth, parse(idSchema, id));
  }

  /** 更新当前团队资料。 */
  @Put('account/:id')
  @UseGuards(AuthGuard)
  updateTeam(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
    @Body() body: unknown,
  ): ReturnType<AccountsService['updateTeam']> {
    return this.accountsService.updateTeam(
      request.auth,
      parse(idSchema, id),
      parse(teamUpdateSchema, body),
    );
  }
}
