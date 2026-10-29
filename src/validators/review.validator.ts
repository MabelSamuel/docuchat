import { z } from 'zod';

export const listReviewsSchema = z.object({
  query: z.object({
    status: z.enum(['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ESCALATED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const reviewParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid review ID'),
  }),
});

export const reviewDecisionSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid review ID'),
  }),
  body: z.object({
    action: z.enum(['approve', 'reject']),
    editedAnswer: z.string().min(1).max(20000).optional(),
    reviewerNotes: z.string().max(5000).optional(),
  }),
});
