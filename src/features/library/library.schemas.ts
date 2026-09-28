import { z } from 'zod';

export const libraryId = z.coerce.number().int().positive();
export const libraryIds = z.object({ ids: z.array(libraryId).min(1).max(100) }).strict();
export const libraryPage = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  users: z.string().max(1000).optional(),
});
export const materialCategory = z.enum(['role', 'scene', 'item', 'prop', 'audio', 'text', 'other']);
export const subjectCategory = z.enum(['character', 'scene', 'prop', 'effects', 'other']);
export const libraryNodeCategory = z.enum(['video', 'image', 'audio', 'text', 'other']);

export const createMaterial = z
  .object({
    category: materialCategory,
    mime_type: z.string().trim().min(1).max(100),
    material_name: z.string().trim().min(1).max(100),
    content: z.string().min(1).max(4096),
    cover_image: z.string().max(2048),
    node_id: libraryId,
  })
  .strict();

export const subjectFields = z
  .object({
    category: subjectCategory,
    content: z.array(z.string().min(1).max(2048)).min(1).max(20),
    description: z.string().max(2000),
    timbre_id: z.coerce.number().int().nonnegative(),
    subject_name: z.string().trim().min(1).max(100),
    is_image: z.boolean(),
  })
  .strict();
export const updateSubject = subjectFields.extend({ subject_id: libraryId });

export const upsertLibraryNode = z
  .object({
    id: libraryId.optional(),
    cover_image: z.string().max(2048).optional(),
    title: z.string().trim().min(1).max(32),
    remark: z.string().max(255).optional(),
    tags: z.array(z.string().trim().min(1).max(16)).max(5).optional(),
    parent_node_id: libraryId,
  })
  .strict();

export const createTimbre = z
  .object({
    audio_url: z.string().min(1).max(2048),
    timbre_name: z.string().trim().min(1).max(100),
  })
  .strict();
