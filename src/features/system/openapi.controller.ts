import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';

@Controller()
export class OpenApiController {
  /** 读取并返回仓库中生成的 OpenAPI 文档。 */
  @Get('openapi.json')
  async document(): Promise<unknown> {
    return JSON.parse(await readFile(join(process.cwd(), 'openapi', 'openapi.json'), 'utf8'));
  }
}
