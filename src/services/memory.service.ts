import { randomUUID } from 'crypto';
import type { MemoryType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateEmbeddingCached } from '../services/embedding.service';
import { logger } from '../lib/logger';

function toVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export const memoryService = {
  async store(data: {
    userId: string;
    type: MemoryType;
    content: string;
    source?: string;
    importance?: number;
    ttlDays?: number | undefined;
  }) {
    // Generate embedding for semantic retrieval
    const embedding = await generateEmbeddingCached(data.content, {
      userId: data.userId,
    });

    // Check for duplicate or near-duplicate memories
    const [duplicate] = await this.findSimilar(
      data.userId,
      embedding,
      0.95  // very high threshold = near-duplicate
    );

    if (duplicate) {
      // Update the existing memory instead of creating a duplicate
      return prisma.memory.update({
        where: { id: duplicate.id },
        data: {
          content: data.content,
          importance: Math.max(
            duplicate.importance,
            data.importance ?? 0.5
          ),
        },
        select: { id: true, content: true, type: true, importance: true },
      });
    }

    const expiresAt = data.ttlDays
      ? new Date(Date.now() + data.ttlDays * 86400000)
      : null;

    // Store with vector embedding via raw SQL
    // (Prisma does not natively support pgvector inserts)
    const [memory] = await prisma.$queryRaw<
      Array<{ id: string; content: string; type: MemoryType; importance: number }>
    >`
      INSERT INTO "Memory" (
        id, "userId", type, content, embedding,
        source, importance, "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${data.userId}, ${data.type}::"MemoryType",
        ${data.content}, ${toVector(embedding)}::vector,
        ${data.source ?? null}, ${data.importance ?? 0.5},
        ${expiresAt}, NOW(), NOW()
      ) RETURNING id, content, type, importance
    `;

    logger.info('Memory stored', {
      userId: data.userId,
      type: data.type,
      content: data.content.substring(0, 100),
    });

    return memory;
  },

  async retrieve(userId: string, query: string, limit = 5) {
    const queryEmbedding = await generateEmbeddingCached(query, { userId });

    // Semantic search across this user's memories
    const memories = await prisma.$queryRaw<
      Array<{
        id: string;
        type: MemoryType;
        content: string;
        importance: number;
        accessCount: number;
        similarity: number;
      }>
    >`
      SELECT id, type, content, importance, "accessCount",
        1 - (embedding <=> ${toVector(queryEmbedding)}::vector) AS similarity
      FROM "Memory"
      WHERE "userId" = ${userId}
        AND embedding IS NOT NULL
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      ORDER BY
        similarity DESC,
        importance DESC
      LIMIT ${limit}
    `;

    // Update access tracking
    const ids = memories.map(m => m.id);
    if (ids.length > 0) {
      await prisma.memory.updateMany({
        where: { id: { in: ids } },
        data: {
          accessCount: { increment: 1 },
          lastAccessedAt: new Date(),
        },
      });
    }

    return memories;
  },

  async findSimilar(userId: string, embedding: number[], threshold: number) {
    const vector = toVector(embedding);

    return prisma.$queryRaw<
      Array<{ id: string; content: string; importance: number; similarity: number }>
    >`
      SELECT id, content, importance,
        1 - (embedding <=> ${vector}::vector) AS similarity
      FROM "Memory"
      WHERE "userId" = ${userId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${vector}::vector) > ${threshold}
      ORDER BY similarity DESC
      LIMIT 3
    `;
  },
};
