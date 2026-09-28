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
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { ScriptsService } from './scripts.service';
import {
  confirmStep,
  createScript,
  generateStep,
  optimizeStep,
  scriptCost,
  scriptId,
  scriptIds,
  scriptPage,
  updateScript,
  updateStep,
} from './scripts.schemas';

@Controller('api')
@UseGuards(AuthGuard)
export class ScriptsController {
  /** 处理剧本、步骤、回收站和个人导入请求。 */
  constructor(@Inject(ScriptsService) private readonly scripts: ScriptsService) {}

  /** 剧本模型配置缺失时返回明确不可用错误。 */
  @Get('script/attrs')
  attrs(): never {
    return this.scripts.attrs();
  }

  /** 校验询价参数并报告当前缺少价格配置。 */
  @Get('script/getCost')
  cost(@Query() query: unknown): never {
    parse(scriptCost, query);
    return this.scripts.getCost();
  }

  /** 创建剧本草稿和固定七步。 */
  @Post('script')
  create(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['create']> {
    return this.scripts.create(request.auth, parse(createScript, body));
  }

  /** 更新剧本标题或分集配置。 */
  @Put('script')
  update(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['update']> {
    return this.scripts.update(request.auth, parse(updateScript, body));
  }

  /** 查询账号下可见的剧本。 */
  @Get('script')
  list(@Req() request: AuthedRequest, @Query() query: unknown): ReturnType<ScriptsService['list']> {
    const input = parse(scriptPage, query);
    return this.scripts.list(request.auth, input.page, input.limit, input.name);
  }

  /** 查询当前用户个人账号的可导入剧本。 */
  @Get('script/personal')
  personal(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<ScriptsService['list']> {
    const input = parse(scriptPage, query);
    return this.scripts.list(request.auth, input.page, input.limit, input.name, true);
  }

  /** 从个人账号复制剧本、步骤和分集。 */
  @Post('script/import')
  importPersonal(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['importPersonal']> {
    return this.scripts.importPersonal(request.auth, parse(scriptIds, body).ids);
  }

  /** 查询当前账号的剧本回收站。 */
  @Get('script/recycleBin')
  recycled(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): ReturnType<ScriptsService['recycled']> {
    const input = parse(scriptPage, query);
    return this.scripts.recycled(request.auth, input.page, input.limit, input.name);
  }

  /** 批量将剧本移入回收站。 */
  @Post('script/batchDestroy')
  batchRecycle(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['recycle']> {
    return this.scripts.recycle(request.auth, parse(scriptIds, body).ids);
  }

  /** 修改步骤正文。 */
  @Put('script/update')
  updateStep(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['updateStep']> {
    return this.scripts.updateStep(request.auth, parse(updateStep, body));
  }

  /** 确认已有内容的步骤。 */
  @Put('script/confirmStep')
  confirmStep(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['confirmStep']> {
    return this.scripts.confirmStep(request.auth, parse(confirmStep, body));
  }

  /** 旧生成协议尚无稳定 request_id，供应商与价格未配置时直接拒绝。 */
  @Put('script/generate')
  generate(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['unavailableGeneration']> {
    const input = parse(generateStep, body);
    return this.scripts.unavailableGeneration(request.auth, input.script_id);
  }

  /** AI 优化仍需供应商、价格与稳定请求标识。 */
  @Put('script/optimize')
  optimize(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<ScriptsService['unavailableGeneration']> {
    const input = parse(optimizeStep, body);
    return this.scripts.unavailableGeneration(request.auth, input.script_id);
  }

  /** 恢复回收站剧本。 */
  @Put('script/restore/:id')
  restore(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<ScriptsService['restore']> {
    return this.scripts.restore(request.auth, parse(scriptId, id));
  }

  /** 读取剧本及步骤详情。 */
  @Get('script/:id')
  detail(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<ScriptsService['detail']> {
    return this.scripts.detail(request.auth, parse(scriptId, id));
  }

  /** 将剧本移入回收站。 */
  @Put('script/:id')
  recycle(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<ScriptsService['recycle']> {
    return this.scripts.recycle(request.auth, [parse(scriptId, id)]);
  }

  /** 永久删除回收站剧本。 */
  @Delete('script/:id')
  destroy(
    @Req() request: AuthedRequest,
    @Param('id') id: unknown,
  ): ReturnType<ScriptsService['destroy']> {
    return this.scripts.destroy(request.auth, parse(scriptId, id));
  }
}
