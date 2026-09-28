import { z } from 'zod';

export const activityId = z.coerce.number().int().positive();
export const activityPage = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const activitySignupQuery = z.object({ activity_id: activityId }).strict();

/** 活动报名字段沿用前端协议，个人和团队资料都持久化。 */
export const activitySignup = z
  .object({
    activity_id: activityId,
    entry_type: z.union([z.literal(1), z.literal(2)]),
    contact_mobile: z.string().regex(/^1\d{10}$/),
    contact_email: z.email().max(200),
    true_name: z.string().trim().min(1).max(100),
    speciality: z.array(z.string().trim().min(1).max(100)).max(30),
    opus: z
      .array(
        z.object({ title: z.string().trim().min(1).max(100), url: z.url().max(2048) }).strict(),
      )
      .max(30),
    is_draft: z.boolean(),
    team_people: z.number().int().min(1).max(10000).optional(),
    team_leader: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => value.entry_type === 1 || (value.team_people && value.team_leader), {
    message: '团队报名需要人数和负责人',
  });
