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
import { VoiceService } from './voice.service';

const id = z.coerce.number().int().positive();
const voiceId = z.string().trim().min(1).max(200);
const language = z.enum([
  'chinese',
  'english',
  'japanese',
  'korean',
  'spanish',
  'portuguese',
  'french',
  'indonesian',
  'german',
  'russian',
  'italian',
  'arabic',
  'ukrainian',
  'nederlands',
  'vietnamese',
  'thai',
  'romanian',
  'greek',
  'czech',
  'suomi',
  'hindi',
  'turkish',
  'polski',
]);
const voiceFields = z
  .object({
    voice_url: z.string().trim().min(1).max(2048),
    voice_id: voiceId,
    voice_name: z.string().trim().min(1).max(100),
    language,
    gender: z.number().int().min(0).max(3),
    age_group: z.number().int().min(1).max(4),
    desc: z.string().max(1000),
  })
  .strict();
const voiceQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    type: z.enum(['system', 'custom', 'collection']),
    voice_name: z.string().trim().max(100).optional(),
    age_group: z
      .string()
      .regex(/^[1-4]$/)
      .optional(),
    gender: z
      .string()
      .regex(/^[0-3]$/)
      .optional(),
    language: language.optional(),
    accent: z.coerce.number().int().min(1).max(2).optional(),
  })
  .strict();

@Controller('api/voice')
@UseGuards(AuthGuard)
export class VoiceController {
  /** 音色目录与收藏使用账号和用户双重隔离。 */
  constructor(@Inject(VoiceService) private readonly voices: VoiceService) {}

  /** 查询系统、个人或收藏音色。 */
  @Get() list(@Req() r: AuthedRequest, @Query() q: unknown): ReturnType<VoiceService['list']> {
    return this.voices.list(r.auth, parse(voiceQuery, q));
  }
  /** 切换音色收藏。 */
  @Post('collect') collect(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<VoiceService['toggleCollection']> {
    return this.voices.toggleCollection(
      r.auth,
      parse(z.object({ voice_id: voiceId }).strict(), b).voice_id,
    );
  }
  /** 克隆登记需要供应商结果校验。 */
  @Post('create') create(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<VoiceService['unavailableCreate']> {
    const input = parse(voiceFields, b);
    return this.voices.unavailableCreate(r.auth, input.voice_url);
  }
  /** 更新本人音色展示资料。 */
  @Put('update') update(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<VoiceService['update']> {
    return this.voices.update(r.auth, parse(voiceFields.extend({ id }), b));
  }
  /** 删除本人音色。 */
  @Delete('delete') delete(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<VoiceService['delete']> {
    return this.voices.delete(r.auth, parse(z.object({ id }).strict(), b).id);
  }
  /** 验证样本归属后调用声音克隆供应商。 */
  @Post('clone') clone(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): ReturnType<VoiceService['clone']> {
    const input = parse(
      z
        .object({
          text: z.string().trim().min(1).max(5000),
          sample_url: z.string().trim().min(1).max(2048),
          noise_reduction: z.boolean(),
        })
        .strict(),
      b,
    );
    return this.voices.clone(r.auth, input.sample_url);
  }
}
