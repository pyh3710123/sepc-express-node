import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { CollaborationService } from './collaboration.service';

@Controller('api')
@UseGuards(AuthGuard)
export class CollaborationController {
  /** 注入协作服务并处理加入画布的 HTTP 请求。 */
  constructor(@Inject(CollaborationService) private readonly collaboration: CollaborationService) {}

  /** 校验画布和客户端参数后加入对应的 WebSocket 协作房间。 */
  @Post('team/join')
  join(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<CollaborationService['join']> {
    const input = parse(
      z.object({
        drama_id: z.coerce.number().int().positive(),
        canvas_id: z.coerce.number().int().positive(),
        client_id: z.string().uuid(),
        last_version: z.number().int().nonnegative().optional(),
      }),
      body,
    );
    return this.collaboration.join(
      request.auth,
      input.drama_id,
      input.canvas_id,
      input.client_id,
      input.last_version,
    );
  }

  /** 验证剧本归属并将当前 WS 客户端加入独占的剧本编辑会话。 */
  @Post('team/join/script')
  joinScript(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): ReturnType<CollaborationService['joinScript']> {
    const input = parse(
      z
        .object({ script_id: z.coerce.number().int().positive(), client_id: z.string().uuid() })
        .strict(),
      body,
    );
    return this.collaboration.joinScript(request.auth, input.script_id, input.client_id);
  }
}
