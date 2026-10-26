import { prisma } from '../lib/prisma';
import { generateEmbeddingCached } from './embedding.service';
import { logger } from '../lib/logger';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  score: number;       // Cosine similarity (0 to 1, higher = more similar)
  tokenCount: number;
}

export async function semanticSearch(options: {
  query: string;
  userId: string;
  documentId?: string | undefined;  // Optional: search within a specific document
  topK?: number;
  minScore?: number;
  correlationId: string;
}): Promise<SearchResult[]> {
  const {
    query,
    userId,
    documentId,
    topK = 10,
    minScore = 0.3,
    correlationId,
  } = options;

  const startTime = Date.now();

  // Step 1: Embed the query
  const queryEmbedding = await generateEmbeddingCached(query, { userId, documentId });
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  // Step 2: Search pgvector with ownership filter
  const results = await prisma.$queryRaw<SearchResult[]>`
    SELECT
      c.id AS "chunkId",
      c."documentId",
      d.title AS "documentTitle",
      c.content,
      c.index AS "chunkIndex",
      c."tokenCount",
      1 - (c.embedding <=> ${vectorStr}::vector) AS score
    FROM "Chunk" c
    JOIN "Document" d ON d.id = c."documentId"
    WHERE d."userId" = ${userId}
      AND d."deletedAt" IS NULL
      AND d.status = 'ready'
      AND c.embedding IS NOT NULL
      ${documentId
        ? prisma.$queryRaw`AND d.id = ${documentId}`
        : prisma.$queryRaw``}
    ORDER BY c.embedding <=> ${vectorStr}::vector
    LIMIT ${topK}
  `;

  // Filter by minimum score
  const filtered = results.filter(r => r.score >= minScore);

  const duration = Date.now() - startTime;
  logger.info('Semantic search completed', {
    query: query.substring(0, 100),
    totalResults: results.length,
    filteredResults: filtered.length,
    topScore: filtered[0]?.score?.toFixed(4),
    durationMs: duration,
    correlationId
  });

  return filtered;
}
