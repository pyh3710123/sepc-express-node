import { z } from 'zod';

const id = z.coerce.number().int().positive();
const media = z.string().trim().min(1).max(2048);
const prompt = z.string().max(10000);
const positiveSize = z.number().int().positive().max(16384);
const region = z
  .object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    w: positiveSize,
    h: positiveSize,
  })
  .strict();
const base = { drama_id: id, node_id: id };

/** 与 Nuxt scene 请求体逐项对齐，拒绝未登记参数进入付费任务。 */
export const sceneSchemas = {
  crop: z.object({ ...base, video: media, ...region.shape }).strict(),
  angle: z
    .object({
      ...base,
      image: media,
      prompt,
      use_prompt: z.boolean(),
      horizontal: z.number().min(0).max(345),
      vertical: z.number().min(-90).max(90),
      zoom: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .strict(),
  matting: z.object({ ...base, image: media }).strict(),
  expand: z
    .object({
      ...base,
      count: z.number().int().min(1).max(8),
      image: media,
      resolution: z.string().min(1).max(50),
      expand_position: z
        .object({
          top: z.number().int().nonnegative(),
          bottom: z.number().int().nonnegative(),
          left: z.number().int().nonnegative(),
          right: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  redraw: z
    .object({
      ...base,
      count: z.number().int().min(1).max(8),
      mask_image: media,
      image: media,
      prompt,
      resolution: z.string().min(1).max(50),
      ratio: z.string().min(1).max(20),
    })
    .strict(),
  erase: z
    .object({
      ...base,
      mask_image: media,
      image: media,
      prompt,
      resolution: z.string().min(1).max(50),
      ratio: z.string().min(1).max(20),
    })
    .strict(),
  lighten: z
    .object({
      ...base,
      brightness: z.number().min(0).max(100),
      is_intelligent: z.boolean(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      main_source: z.enum(['left', 'right', 'front', 'behind', 'bottom', 'top']),
      outline_light: z.boolean(),
      prompt,
      image: media,
      reference_image: z.string().max(2048),
    })
    .strict(),
  'video-audio-split': z.object({ drama_id: id, video: media }).strict(),
  'vocal-split': z
    .object({
      ...base,
      canvas_id: id,
      video: media,
      mode: z.enum(['vocal', 'accompaniment']),
      duration: z.number().positive(),
    })
    .strict(),
  'frame-prediction': z
    .object({ ...base, image: media, type: z.enum(['3sAfter', '5sBefore']) })
    .strict(),
  upscale: z
    .object({
      ...base,
      canvas_id: id,
      image: media,
      upscale_model: z.string().min(1).max(100),
      scale: z.string().min(1).max(20),
    })
    .strict(),
  upscaleVideo: z
    .object({
      ...base,
      canvas_id: id,
      video: media,
      video_resolution: z.string().min(1).max(50),
      interp: z.string().min(1).max(50),
      slowmo: z.number().positive(),
      fps: z.number().positive().optional(),
    })
    .strict(),
  videoErase: z
    .object({
      ...base,
      canvas_id: id,
      video: media,
      duration: z.number().positive(),
      regions: z.array(region).min(1).max(20).optional(),
      video_width: positiveSize.optional(),
      video_height: positiveSize.optional(),
    })
    .strict()
    .refine((value) => !value.regions || (value.video_width && value.video_height), {
      message: '框选擦除需要视频尺寸',
    }),
} as const;

export type SceneName = keyof typeof sceneSchemas;
export type SceneInput = {
  drama_id: number;
  node_id?: number;
  canvas_id?: number;
  image?: string;
  video?: string;
  mask_image?: string;
  reference_image?: string;
};
