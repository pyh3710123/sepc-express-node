import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { PermissionsService } from './permissions.service';

const projectType = z.enum(['drama', 'script']);
const projectId = z.coerce.number().int().positive();
const globalSettings = z.object({ can_create: z.boolean(), assets_share: z.boolean() }).strict();
const projectSettings = globalSettings
  .extend({
    project_type: projectType.optional(),
    project_id: projectId.optional(),
    list: z
      .array(
        z
          .object({
            user_id: projectId,
            permission_code: z.enum(['editor', 'viewer', 'none']),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

@Controller('api/data/permission')
@UseGuards(AuthGuard)
export class PermissionsController {
  /** 将项目权限协议委托给统一策略服务。 */
  constructor(@Inject(PermissionsService) private readonly permissions: PermissionsService) {}

  /** 查询团队全局创建与资产共享设置。 */
  @Get()
  global(@Req() request: AuthedRequest): ReturnType<PermissionsService['global']> {
    return this.permissions.global(request.auth);
  }

  /** 保存团队全局权限。 */
  @Post()
  saveGlobal(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<PermissionsService['saveGlobal']> {
    return this.permissions.saveGlobal(request.auth, parse(globalSettings, body));
  }

  /** 查询指定短剧或剧本的成员权限。 */
  @Get('project')
  project(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<PermissionsService['projectMembers']> {
    const input = parse(z.object({ project_type: projectType, project_id: projectId }), query);
    return this.permissions.projectMembers(request.auth, input.project_type, input.project_id);
  }

  /** 保存全局设置与指定项目的成员权限。 */
  @Post('project')
  saveProject(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<PermissionsService['saveProject']> {
    return this.permissions.saveProject(request.auth, parse(projectSettings, body));
  }
}
