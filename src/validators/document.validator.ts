import { z } from "zod";

export const createDocumentSchema = z.object({
  body: z.object({
    title: z.string().min(1, "Title is required").max(500),
    content: z.string().min(1, "Content is required"),
  }),
});

export const listDocumentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['pending','processing','ready','failed']).optional(),
    search: z.string().max(200).optional(),
    sortBy: z.enum(['createdAt','title','chunkCount']).default('createdAt'),
    sortOrder: z.enum(['asc','desc']).default('desc'),
  }),
});

export const documentParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Invalid document ID"),
  }),
});