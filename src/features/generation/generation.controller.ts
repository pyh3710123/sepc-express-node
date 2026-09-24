import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { GenerationService } from './generation.service';

@Controller('api')
@UseGuards(AuthGuard)
export class GenerationController {
  /** 注入生成服务，控制器负责接口路由与请求身份传递。 */
  constructor(@Inject(GenerationService) private readonly service: GenerationService) {}

  /** 查询可用模型与能力配置。 */
  @Get('node/models')
  models(): ReturnType<GenerationService['models']> {
    return this.service.models();
  }
  /** 校验输入并估算生成任务积分。 */
  @Post('node/credit')
  quote(@Req() req: AuthedRequest, @Body() body: unknown): ReturnType<GenerationService['quote']> {
    return this.service.quote(req.auth, body);
  }
  /** 校验并创建单个生成任务。 */
  @Post('task/generation/create')
  create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<GenerationService['create']> {
    return this.service.create(req.auth, body);
  }
  /** 校验并批量创建生成任务。 */
  @Post('task/generation/batch_create')
  batch(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<GenerationService['batchCreate']> {
    return this.service.batchCreate(req.auth, body);
  }
  /** 查询指定任务的状态和进度。 */
  @Post('task/generation/progress')
  progress(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<GenerationService['progress']> {
    return this.service.progress(req.auth, body);
  }
  /** 校验任务 ID 并取消尚未开始运行的任务。 */
  @Post('task/generation/cancel')
  cancel(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<GenerationService['cancel']> {
    const input = parse(z.object({ task_id: z.string().uuid() }), body);
    return this.service.cancel(req.auth, input.task_id);
  }
}
