import { z } from 'zod';

export const teamId = z.coerce.number().int().positive();
export const createRole = z.object({ role_name: z.string().trim().min(1).max(30) }).strict();
export const invite = z
  .object({
    mobile: z.string().regex(/^1\d{10}$/),
    role_id: teamId,
    permissions: z
      .array(
        z
          .object({
            project_type: z.enum(['drama', 'script']),
            project_id: teamId,
            permission_code: z.enum(['editor', 'viewer', 'none']),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
  })
  .strict();
export const resolveInvite = z.object({ invite_id: teamId, accept: z.boolean() }).strict();
