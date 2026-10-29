import { z } from 'zod';

export const userParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid user ID'),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid user ID'),
  }),
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
  }).refine(
    body => body.name !== undefined || body.isActive !== undefined,
    'Provide at least one of: name, isActive'
  ),
});
