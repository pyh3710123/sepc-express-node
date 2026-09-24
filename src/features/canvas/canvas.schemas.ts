import { z } from 'zod';

const id = z.coerce.number().int().positive();
/** 校验画布、节点及连线接口使用的正整数 ID。 */
export const canvasIdSchema = id;
const uuid = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w.-]+$/);
const position = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const size = z
  .object({ width: z.number().positive().max(10000), height: z.number().positive().max(10000) })
  .strict();
const extraData = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 16384, 'extra_data is too large');
const nodeFields = z
  .object({
    uuid,
    type: z.string().min(1).max(50),
    node_name: z.string().max(200),
    position,
    size: size.optional(),
    parent_uuid: uuid.nullable().optional(),
    z_index: z.number().int().min(-100000).max(100000).optional(),
    content: z.string().max(100000).nullable().optional(),
    extra_data: extraData.optional(),
  })
  .strict();
const nodeCreate = nodeFields;
const nodeUpdate = nodeFields.partial().extend({ id, uuid: uuid.optional() }).strict();
const edgeFields = z
  .object({
    uuid,
    source_uuid: uuid,
    target_uuid: uuid,
    source_anchor: z.string().max(100).nullable().optional(),
    target_anchor: z.string().max(100).nullable().optional(),
    type: z.string().max(50).nullable().optional(),
    extra_data: extraData.optional(),
  })
  .strict();
const edgeCreate = edgeFields;
const edgeUpdate = edgeFields.partial().extend({ id, uuid: uuid.optional() }).strict();
/** 构造支持新增、更新和删除的批量操作参数结构。 */
function operations<T extends z.ZodTypeAny, U extends z.ZodTypeAny>(create: T, update: U) {
  return z
    .object({
      create: z.array(create).default([]),
      update: z.array(update).default([]),
      delete: z.array(z.object({ id }).strict()).default([]),
    })
    .strict()
    .default({ create: [], update: [], delete: [] });
}
/** 校验画布节点与连线的原子批量保存请求。 */
export const batchSchema = z
  .object({
    drama_id: id,
    canvas_id: id,
    expected_version: z.number().int().nonnegative(),
    nodes: operations(nodeCreate, nodeUpdate),
    connections: operations(edgeCreate, edgeUpdate),
  })
  .strict();
export type BatchInput = z.infer<typeof batchSchema>;
