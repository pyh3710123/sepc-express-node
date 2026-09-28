import { z } from 'zod';

export const scriptId = z.coerce.number().int().positive();
export const scriptPage = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(20),
    name: z.string().trim().max(100).optional(),
  })
  .strict();
export const scriptIds = z.object({ ids: z.array(scriptId).min(1).max(100) }).strict();
export const createScript = z
  .object({
    input_text: z.string().trim().min(1).max(20000),
    attr_ids: z.string().regex(/^(\d+)(,\d+)*$|^$/),
    model_code: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200).default('未命名剧本'),
    episode_count: z.coerce.number().int().min(1).max(100).default(8),
    episode_duration: z.coerce.number().int().min(1).max(120).default(2),
  })
  .strict();
export const updateScript = z
  .object({
    script_id: scriptId,
    title: z.string().trim().min(1).max(200).optional(),
    episode_count: z.coerce.number().int().min(1).max(100).optional(),
    episode_duration: z.coerce.number().int().min(1).max(120).optional(),
    expected_revision: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.episode_count !== undefined ||
      value.episode_duration !== undefined,
  );
export const updateStep = z
  .object({
    script_id: scriptId,
    step_id: scriptId,
    episode_id: scriptId.optional(),
    content: z.string().max(100000),
    expected_version: z.coerce.number().int().positive().optional(),
  })
  .strict();
export const confirmStep = z
  .object({
    script_id: scriptId,
    step_id: scriptId,
    episode_id: scriptId.optional(),
    expected_version: z.coerce.number().int().positive().optional(),
  })
  .strict();
export const generateStep = z
  .object({
    script_id: scriptId,
    step: z.coerce.number().int().min(1).max(7),
    episode_num: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export const optimizeStep = z
  .object({
    script_id: scriptId,
    step_id: scriptId,
    episode_id: scriptId.optional(),
    instruction: z.string().trim().min(1).max(5000),
  })
  .strict();
export const scriptCost = z
  .object({
    attr_ids: z.string().regex(/^(\d+)(,\d+)*$|^$/),
    model_code: z.string().trim().min(1).max(100),
    input_text: z.string().max(20000),
  })
  .strict();
