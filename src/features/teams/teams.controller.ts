import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { TeamsService } from './teams.service';
import { createRole, invite, resolveInvite, teamId } from './teams.schemas';

@Controller('api/account')
@UseGuards(AuthGuard)
export class TeamsController {
  /** 团队角色与邀请路由共用事务服务。 */
  constructor(@Inject(TeamsService) private readonly teams: TeamsService) {}

  /** 查询当前团队可选角色。 */
  @Get('role')
  roles(@Req() request: AuthedRequest): ReturnType<TeamsService['roles']> {
    return this.teams.roles(request.auth);
  }

  /** 创建自定义成员角色。 */
  @Post('role')
  createRole(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<TeamsService['createRole']> {
    return this.teams.createRole(request.auth, parse(createRole, body).role_name);
  }

  /** 删除未使用的自定义角色。 */
  @Delete('role/:id')
  deleteRole(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<TeamsService['deleteRole']> {
    return this.teams.deleteRole(request.auth, parse(teamId, id));
  }

  /** 向已注册用户发出团队邀请。 */
  @Post('invite')
  invite(@Req() request: AuthedRequest, @Body() body: unknown): ReturnType<TeamsService['invite']> {
    return this.teams.invite(request.auth, parse(invite, body));
  }

  /** 邀请接收者接受或拒绝加入。 */
  @Post('accept')
  accept(@Req() request: AuthedRequest, @Body() body: unknown): ReturnType<TeamsService['accept']> {
    const input = parse(resolveInvite, body);
    return this.teams.accept(request.auth, input.invite_id, input.accept);
  }

  /** 查询待审核加入申请。 */
  @Get('invite')
  applications(@Req() request: AuthedRequest): ReturnType<TeamsService['applications']> {
    return this.teams.applications(request.auth);
  }

  /** 审核团队加入申请。 */
  @Post('invite/review')
  review(@Req() request: AuthedRequest, @Body() body: unknown): ReturnType<TeamsService['review']> {
    const input = parse(resolveInvite, body);
    return this.teams.review(request.auth, input.invite_id, input.accept);
  }
}
