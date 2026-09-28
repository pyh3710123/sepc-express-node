import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { StatisticsService } from './statistics.service';

const id = z.coerce.number().int().positive();
const page = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

@Controller('api/data/statistics')
@UseGuards(AuthGuard)
export class StatisticsController {
  /** 团队数据中心所有查询都由服务层校验管理员身份。 */
  constructor(@Inject(StatisticsService) private readonly statistics: StatisticsService) {}
  /** 顶部总消耗与产出概览。 */
  @Get('panel') panel(@Req() r: AuthedRequest): ReturnType<StatisticsService['panel']> {
    return this.statistics.panel(r.auth);
  }
  /** 项目消耗列表。 */
  @Get('project') projects(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<StatisticsService['projects']> {
    const p = parse(page, q);
    return this.statistics.projects(r.auth, p.page, p.limit);
  }
  /** 成员消耗列表。 */
  @Get('member') members(
    @Req() r: AuthedRequest,
    @Query() q: unknown,
  ): ReturnType<StatisticsService['members']> {
    const p = parse(page, q);
    return this.statistics.members(r.auth, p.page, p.limit);
  }
  /** 项目任务消耗明细。 */
  @Get('project/:id') projectDetail(
    @Req() r: AuthedRequest,
    @Param('id') value: unknown,
  ): ReturnType<StatisticsService['projectDetail']> {
    return this.statistics.projectDetail(r.auth, parse(id, value));
  }
  /** 成员任务消耗明细。 */
  @Get('member/:id') memberDetail(
    @Req() r: AuthedRequest,
    @Param('id') value: unknown,
  ): ReturnType<StatisticsService['memberDetail']> {
    return this.statistics.memberDetail(r.auth, parse(id, value));
  }
}
