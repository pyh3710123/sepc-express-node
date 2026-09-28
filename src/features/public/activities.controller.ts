import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { parse } from '../../common';
import { AuthGuard, AuthService, type AuthedRequest } from '../auth';
import { ActivitiesService } from './activities.service';
import {
  activityId,
  activityPage,
  activitySignup,
  activitySignupQuery,
} from './activities.schemas';
import { publishOpus } from './opuses.schemas';

@Controller('api/activity')
export class ActivitiesController {
  /** 活动目录公开，报名和投稿使用当前会话身份。 */
  constructor(
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  /** 已发布活动列表。 */
  @Get() list(@Query() q: unknown): ReturnType<ActivitiesService['list']> {
    const input = parse(activityPage, q);
    return this.activities.list(input.page, input.limit);
  }
  /** 正式报名或保存草稿。 */
  @Post('signup')
  @UseGuards(AuthGuard)
  signup(@Req() r: AuthedRequest, @Body() b: unknown): ReturnType<ActivitiesService['signup']> {
    return this.activities.signup(r.auth, parse(activitySignup, b));
  }
  /** 查询本人正式报名审核状态。 */
  @Get('signup')
  @UseGuards(AuthGuard)
  signupDetail(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<ActivitiesService['signupDetail']> {
    return this.activities.signupDetail(r.auth, parse(activitySignupQuery, q).activity_id);
  }
  /** 查询尚未提交的报名草稿。 */
  @Get('signup/draft')
  @UseGuards(AuthGuard)
  draft(@Req() r: AuthedRequest, @Query() q: unknown): ReturnType<ActivitiesService['draft']> {
    return this.activities.draft(r.auth, parse(activitySignupQuery, q).activity_id);
  }
  /** 已报名活动下拉。 */
  @Get('signup/select')
  @UseGuards(AuthGuard)
  signedUp(@Req() r: AuthedRequest): ReturnType<ActivitiesService['signedUp']> {
    return this.activities.signedUp(r.auth);
  }
  /** 活动投稿与普通作品发布共用校验和事务。 */
  @Post('opus')
  @UseGuards(AuthGuard)
  submitOpus(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<ActivitiesService['submitOpus']> {
    return this.activities.submitOpus(
      r.auth,
      parse(publishOpus.required({ activity_id: true }).omit({ opus_id: true }), b),
    );
  }
  /** 公开活动详情，登录用户附带自己的报名状态。 */
  @Get(':id')
  async detail(
    @Req() r: { headers: { authorization?: string } },
    @Param('id') id: unknown,
  ): ReturnType<ActivitiesService['detail']> {
    const bearer = r.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const actor = bearer ? await this.auth.authenticate(bearer) : undefined;
    return this.activities.detail(parse(activityId, id), actor);
  }
}
