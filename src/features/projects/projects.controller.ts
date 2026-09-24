import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import {
  batchMoveDramaSchema,
  createDramaSchema,
  dramaIdsBody,
  mergeDramaSchema,
  moveDramaSchema,
  paginationSchema,
  updateDramaSchema,
} from './projects.schemas';
import { ProjectsService } from './projects.service';

@Controller('api')
@UseGuards(AuthGuard)
export class ProjectsController {
  /** 注入项目服务，控制器仅负责路由输入校验和身份传递。 */
  constructor(@Inject(ProjectsService) private readonly service: ProjectsService) {}

  /** 按页查询当前账号的项目。 */
  @Get('drama')
  list(
    @Req() req: AuthedRequest,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
    @Query('parent_id') parentId: unknown,
    @Query('name') name: unknown,
    @Query('all') all: unknown,
  ): ReturnType<ProjectsService['listDramas']> {
    const input = parse(
      paginationSchema.extend({
        parent_id: z.coerce.number().int().nonnegative().optional(),
        name: z.string().trim().max(100).optional(),
        all: z.enum(['0', '1', '2']).default('0'),
      }),
      { page, limit, parent_id: parentId, name, all },
    );
    return this.service.listDramas(req.auth, input.page, input.limit, {
      parentId: input.parent_id,
      name: input.name,
      all: input.all,
    });
  }
  /** 返回包含各项目组子项目的短剧平铺列表。 */
  @Get('drama/subset')
  subsetDramas(
    @Req() req: AuthedRequest,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
  ): ReturnType<ProjectsService['subsetDramas']> {
    const input = parse(
      z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      }),
      { page, limit },
    );
    return this.service.subsetDramas(req.auth, input.page, input.limit);
  }
  /** 校验项目组归属并创建项目或项目组。 */
  @Post('drama')
  createDrama(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['createDrama']> {
    return this.service.createDrama(req.auth, parse(createDramaSchema, body));
  }
  /** 校验当前账号的项目 ID、标题或封面并更新项目。 */
  @Put('drama')
  updateDrama(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['updateDrama']> {
    return this.service.updateDrama(req.auth, parse(updateDramaSchema, body));
  }
  /** 校验项目 ID 列表并移入当前账号的回收站。 */
  @Delete('drama')
  deleteDramas(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['deleteDramas']> {
    const input = parse(dramaIdsBody, body);
    return this.service.deleteDramas(req.auth, input.ids);
  }
  /** 校验单个短剧移动请求。 */
  @Post('drama/move')
  moveDrama(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['moveDramas']> {
    const input = parse(moveDramaSchema, body);
    return this.service.moveDramas(req.auth, {
      ids: [input.drama_id],
      action: input.action,
      targetId: input.action === 'transfer' ? input.target_id : undefined,
    });
  }
  /** 校验批量短剧移动请求。 */
  @Post('drama/batchMove')
  batchMoveDrama(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['moveDramas']> {
    const input = parse(batchMoveDramaSchema, body);
    return this.service.moveDramas(req.auth, {
      ids: input.ids,
      action: input.action,
      targetId: input.action === 'transfer' ? input.target_id : undefined,
    });
  }
  /** 校验需要合并的同层短剧项目。 */
  @Post('drama/merge')
  mergeDramas(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['mergeDramas']> {
    const input = parse(mergeDramaSchema, body);
    return this.service.mergeDramas(req.auth, input.ids);
  }
  /** 校验需要解除的项目组。 */
  @Post('drama/untie')
  untieDramas(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['untieDramas']> {
    const input = parse(dramaIdsBody, body);
    return this.service.untieDramas(req.auth, input.ids);
  }
  /** 按页查询当前账号已删除的项目。 */
  @Get('project/recycle')
  recycledDramas(
    @Req() req: AuthedRequest,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
    @Query('name') name: unknown,
    @Query('type') type: unknown,
  ): ReturnType<ProjectsService['recycledDramas']> {
    const input = parse(
      paginationSchema.extend({
        name: z.string().trim().max(100).optional(),
        type: z.union([z.enum(['drama', 'script']), z.literal(''), z.null()]).optional(),
      }),
      { page, limit, name, type },
    );
    return this.service.recycledDramas(req.auth, input.page, input.limit, {
      name: input.name,
      type: input.type || undefined,
    });
  }
  /** 校验项目 ID 列表并从当前账号的回收站恢复。 */
  @Post('project/recycle/restore')
  restoreDramas(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['restoreDramas']> {
    const input = parse(dramaIdsBody, body);
    return this.service.restoreDramas(req.auth, input.ids);
  }
  /** 校验项目 ID 列表并永久删除已回收的项目。 */
  @Delete('project/recycle')
  destroyRecycledDramas(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ProjectsService['destroyRecycledDramas']> {
    const input = parse(dramaIdsBody, body);
    return this.service.destroyRecycledDramas(req.auth, input.ids);
  }
}
