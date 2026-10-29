import { z } from 'zod';

export const researchSchema = z.object({
  body: z.object({
    question: z.string()
      .min(3, 'Question is too short')
      .max(2000, 'Question too long'),
  }),
});
