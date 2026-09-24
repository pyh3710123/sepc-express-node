import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError, parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { batchSchema, canvasIdSchema } from './canvas.schemas';
import { CanvasService } from './canvas.service';

@Controller('api')
@UseGuards(AuthGuard)
export class CanvasController {
  /** 注入画布服务，控制器负责路由输入校验与身份传递。 */
  constructor(@Inject(CanvasService) private readonly service: CanvasService) {}

  /** 校验项目 ID 和标题并创建画布。 */
  @Post('drama/canvas')
  createCanvas(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<CanvasService['createCanvas']> {
    const input = parse(
      z.object({ drama_id: canvasIdSchema, title: z.string().min(1).max(200) }),
      body,
    );
    return this.service.createCanvas(req.auth, input.drama_id, input.title);
  }
  /** 校验项目查询参数并返回画布选项。 */
  @Get('drama/canvas/options')
  options(
    @Req() req: AuthedRequest,
    @Query('drama_id') dramaId: unknown,
  ): ReturnType<CanvasService['options']> {
    return this.service.options(req.auth, parse(canvasIdSchema, dramaId));
  }
  /** 校验画布 ID 和新标题并执行重命名。 */
  @Put('drama/canvas/rename')
  rename(@Req() req: AuthedRequest, @Body() body: unknown): ReturnType<CanvasService['rename']> {
    const input = parse(
      z.object({ canvas_id: canvasIdSchema, canvas_title: z.string().min(1).max(200) }),
      body,
    );
    return this.service.rename(req.auth, input.canvas_id, input.canvas_title);
  }
  /** 校验画布 ID 和目标标题并复制画布。 */
  @Post('drama/canvas/copy')
  copy(@Req() req: AuthedRequest, @Body() body: unknown): ReturnType<CanvasService['copy']> {
    const input = parse(
      z.object({ canvas_id: canvasIdSchema, canvas_title: z.string().min(1).max(200) }),
      body,
    );
    return this.service.copy(req.auth, input.canvas_id, input.canvas_title);
  }
  /** 校验画布 ID 并返回完整画布内容。 */
  @Get('drama/canvas/:id')
  detail(
    @Req() req: AuthedRequest,
    @Param('id') canvasId: unknown,
  ): ReturnType<CanvasService['detail']> {
    return this.service.detail(req.auth, parse(canvasIdSchema, canvasId));
  }
  /** 校验视口数据并保存当前用户的画布视口。 */
  @Put('drama/canvas/:id')
  viewport(
    @Req() req: AuthedRequest,
    @Param('id') canvasId: unknown,
    @Body() body: unknown,
  ): ReturnType<CanvasService['viewport']> {
    const input = parse(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        window_zoom_rate: z.number().finite().min(10).max(800),
      }),
      body,
    );
    return this.service.viewport(req.auth, parse(canvasIdSchema, canvasId), input);
  }
  /** 校验画布 ID 并按当前用户权限删除画布。 */
  @Delete('drama/canvas/:id')
  delete(
    @Req() req: AuthedRequest,
    @Param('id') canvasId: unknown,
  ): ReturnType<CanvasService['deleteCanvas']> {
    return this.service.deleteCanvas(req.auth, parse(canvasIdSchema, canvasId));
  }
  /** 校验批量编辑请求并提交原子变更。 */
  @Post('node/batch')
  batch(@Req() req: AuthedRequest, @Body() body: unknown): ReturnType<CanvasService['batch']> {
    return this.service.batch(req.auth, parse(batchSchema, body));
  }
  /** 校验节点 ID 列表后批量查询节点。 */
  @Post('nodes')
  nodes(@Req() req: AuthedRequest, @Body() body: unknown): ReturnType<CanvasService['nodesByIds']> {
    const input = parse(z.object({ ids: z.array(canvasIdSchema).max(100) }), body);
    return this.service.nodesByIds(req.auth, input.ids);
  }
  /** 校验连线 ID 后读取指定连线。 */
  @Get('connection/:id')
  connection(
    @Req() req: AuthedRequest,
    @Param('id') connectionId: unknown,
  ): ReturnType<CanvasService['connection']> {
    return this.service.connection(req.auth, parse(canvasIdSchema, connectionId));
  }
  /** 返回当前支持的节点类型清单。 */
  @Get('node')
  types(): { list: { type: string }[] } {
    return {
      list: [
        { type: 'text' },
        { type: 'image' },
        { type: 'video' },
        { type: 'audio' },
        { type: 'group' },
      ],
    };
  }
  /** 媒体签名服务未配置时返回明确的不可用错误。 */
  @Post('node/download')
  download(): never {
    throw new AppError(503, '媒体签名服务未配置');
  }
}
