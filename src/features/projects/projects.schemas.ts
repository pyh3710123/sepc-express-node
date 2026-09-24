import { z } from 'zod';

const id = z.coerce.number().int().positive();
/** 校验项目批量操作传入的 ID 列表。 */
export const dramaIdsBody = z.object({ ids: z.array(id).min(1).max(100) }).strict();
/** 校验单个项目移动请求的两种动作。 */
export const moveDramaSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove'), drama_id: id }).strict(),
  z.object({ action: z.literal('transfer'), drama_id: id, target_id: id }).strict(),
]);
/** 校验批量项目移动请求。 */
export const batchMoveDramaSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove'), ids: z.array(id).min(1).max(100) }).strict(),
  z
    .object({ action: z.literal('transfer'), ids: z.array(id).min(1).max(100), target_id: id })
    .strict(),
]);
/** 校验合并项目组时至少选择两个项目。 */
export const mergeDramaSchema = z.object({ ids: z.array(id).min(2).max(100) }).strict();
/** 校验创建短剧或项目组的请求体。 */
export const createDramaSchema = z
  .object({
    parent_id: z.coerce.number().int().nonnegative().default(0),
    is_group: z.boolean().default(false),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
/** 校验项目标题与封面更新请求。 */
export const updateDramaSchema = z
  .object({
    drama_id: id,
    title: z.string().trim().min(1).max(200).optional(),
    cover_image: z.string().url().max(2048).nullable().optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.cover_image !== undefined);
/** 校验项目列表和回收站共用的分页参数。 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CreateDramaInput = z.infer<typeof createDramaSchema>;
export type UpdateDramaInput = z.infer<typeof updateDramaSchema>;
