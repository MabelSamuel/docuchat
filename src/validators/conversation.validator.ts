import { z } from 'zod';

export const createConversationSchema = z.object({
  body: z.object({
    title: z.string().max(200).optional(),
    documentId: z.string().uuid().optional(),
  }),
});

export const askQuestionSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid conversation ID'),
  }),
  body: z.object({
    question: z.string()
      .min(1, 'Question cannot be empty')
      .max(10000, 'Question too long'),
    documentId: z.string().min(1, 'documentId is required'),
  }),
});

export const sendMessageSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid conversation ID'),
  }),
  body: z.object({
    content: z.string()
      .min(1, 'Message cannot be empty')
      .max(10000, 'Message too long'),
    documentId: z.string().min(1).optional(),
  }),
});
