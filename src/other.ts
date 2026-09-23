import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AppError } from './common';
import { AuthGuard } from './auth';

@Controller()
export class OpenApiController {
  @Get('openapi.json')
  async document(): Promise<unknown> {
    return JSON.parse(await readFile(join(process.cwd(), 'openapi', 'openapi.json'), 'utf8'));
  }
}

@Controller('api')
@UseGuards(AuthGuard)
export class OtherController {
  @Get('oss/sts') oss() {
    throw new AppError(503, 'OSS STS 服务未配置');
  }
  @Post('upload/data') upload() {
    throw new AppError(503, 'OSS 上传登记服务未配置');
  }
  @Post('workflow/execute') workflow() {
    throw new AppError(503, '工作流执行服务尚未接入');
  }
  @Post('order/create') order() {
    throw new AppError(503, '支付服务未配置');
  }
  @Post('volc-asset/check') volc() {
    throw new AppError(503, '火山素材服务未配置');
  }
}
