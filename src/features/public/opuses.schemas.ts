import { z } from 'zod';

const id = z.coerce.number().int().positive();
const media = z.string().trim().min(1).max(2048);

/** 发布作品时使用前端既有字段，媒体 URL 在服务层再次核对账号归属。 */
export const publishOpus = z
  .object({
    opus_id: id.optional(),
    drama_id: id,
    canvas_id: id,
    opus_name: z.string().trim().min(1).max(100),
    type_id: id,
    describe: z.string().max(5000),
    cover_image: media,
    opus_video: media,
    allow_clone: z.boolean().optional(),
    activity_id: id.optional(),
  })
  .strict();

export const opusId = id;
export const opusPage = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const opusMinePage = opusPage.extend({
  is_activity: z.coerce
    .number()
    .pipe(z.union([z.literal(0), z.literal(1)]))
    .optional(),
});
export const opusRecommendPage = opusPage.extend({
  type_id: id.optional(),
  name: z.string().trim().max(100).optional(),
});
export const opusAwardPage = opusPage.extend({ activity_id: id });
