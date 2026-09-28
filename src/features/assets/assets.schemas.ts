import { z } from 'zod';

const id = z.coerce.number().int().positive();
const assetType = z.enum(['image', 'video', 'audio']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 资产页面与图片选择弹窗复用同一路由，按 belong_type 切换响应形状。 */
export const assetQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    asset_type: assetType.optional(),
    start_date: date.optional(),
    end_date: date.optional(),
    belong_type: z.enum(['public', 'private', 'team']).optional(),
    format: z.enum(['picture', 'video', 'audio']).optional(),
    keyword: z.string().trim().max(100).optional(),
  })
  .strict()
  .refine((value) => !value.start_date || !value.end_date || value.start_date <= value.end_date, {
    message: '结束日期不能早于开始日期',
  });

export const assetHistoryQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    asset_type: assetType.optional(),
    users: z
      .string()
      .regex(/^\d+(,\d+)*$/)
      .max(500)
      .optional(),
  })
  .strict();

export const deleteAssets = z.object({ ids: z.array(id).min(1).max(100) }).strict();

export type AssetQuery = z.infer<typeof assetQuery>;
export type AssetHistoryQuery = z.infer<typeof assetHistoryQuery>;
