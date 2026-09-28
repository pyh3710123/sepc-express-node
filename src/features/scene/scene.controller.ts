import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { parse } from '../../common';
import { AuthGuard, type AuthedRequest } from '../auth';
import { SceneService } from './scene.service';
import { sceneSchemas, type SceneInput, type SceneName } from './scene.schemas';

@Controller('api')
@UseGuards(AuthGuard)
export class SceneController {
  /** 所有创作场景共用节点、媒体和项目授权校验。 */
  constructor(@Inject(SceneService) private readonly scene: SceneService) {}

  private run(actor: AuthedRequest['auth'], name: SceneName, body: unknown): Promise<never> {
    const schema = sceneSchemas[name];
    const input = parse<SceneInput>(schema, body);
    return this.scene.unavailable(actor, name, input);
  }

  /** 裁切视频。 */
  @Post('scene/crop') crop(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'crop', b);
  }
  /** 图片多角度生成。 */
  @Post('scene/angle') angle(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'angle', b);
  }
  /** 图片抠图。 */
  @Post('scene/matting') matting(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'matting', b);
  }
  /** 图片扩图。 */
  @Post('scene/expand') expand(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'expand', b);
  }
  /** 图片局部重绘。 */
  @Post('scene/redraw') redraw(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'redraw', b);
  }
  /** 图片擦除。 */
  @Post('scene/erase') erase(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'erase', b);
  }
  /** 图片打光。 */
  @Post('scene/lighten') lighten(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'lighten', b);
  }
  /** 音视频分离。 */
  @Post('scene/video-audio-split') videoAudioSplit(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): Promise<never> {
    return this.run(r.auth, 'video-audio-split', b);
  }
  /** 人声分离。 */
  @Post('scene/vocal-split') vocalSplit(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): Promise<never> {
    return this.run(r.auth, 'vocal-split', b);
  }
  /** 画面推演。 */
  @Post('scene/frame-prediction') framePrediction(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): Promise<never> {
    return this.run(r.auth, 'frame-prediction', b);
  }
  /** 图片高清。 */
  @Post('scene/upscale') upscale(@Req() r: AuthedRequest, @Body() b: unknown): Promise<never> {
    return this.run(r.auth, 'upscale', b);
  }
  /** 视频高清。 */
  @Post('scene/upscaleVideo') upscaleVideo(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): Promise<never> {
    return this.run(r.auth, 'upscaleVideo', b);
  }
  /** 视频擦除。 */
  @Post('scene/videoErase') videoErase(
    @Req() r: AuthedRequest,
    @Body() b: unknown,
  ): Promise<never> {
    return this.run(r.auth, 'videoErase', b);
  }
  /** 读取打光预设。 */
  @Get('lighten/preset') presets(): ReturnType<SceneService['presets']> {
    return this.scene.presets();
  }
}
