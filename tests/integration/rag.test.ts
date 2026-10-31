import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { semanticSearch } from '../../src/services/search.service';
import type * as FakeEmbedding from '../helpers/fake-embedding';
import { deleteTestUsers, seedTestDocument, seedTestUser } from '../helpers/seed';

vi.mock('../../src/services/embedding.service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await vi.importActual<typeof FakeEmbedding>('../helpers/fake-embedding')).fakeEmbeddingService,
}));

const correlationId = 'rag-test';

describe('RAG retrieval quality', () => {
  let testUserId: string;
  let otherUserId: string;
  let testDocumentId: string;

  beforeAll(async () => {
    testUserId = (await seedTestUser()).id;
    otherUserId = (await seedTestUser()).id;
    testDocumentId = await seedTestDocument('doc-refund-policy', testUserId);
  });

  afterAll(async () => {
    await deleteTestUsers(testUserId, otherUserId);
  });

  it('finds the refund policy when asked about returns', async () => {
    const results = await semanticSearch({
      query: 'How do I return a product?',
      userId: testUserId,
      correlationId,
    });

    const top = results[0];
    expect(top).toBeDefined();
    expect(top!.score).toBeGreaterThan(0.5);

    // The top result should contain refund-related content
    const topContent = top!.content.toLowerCase();
    expect(
      topContent.includes('return') ||
      topContent.includes('refund') ||
      topContent.includes('reimbursement')
    ).toBe(true);
  });

  it('returns low scores for irrelevant questions', async () => {
    const results = await semanticSearch({
      query: 'What is quantum computing?',
      userId: testUserId,
      minScore: 0.5,
      correlationId,
    });

    // Should return nothing if documents are about company policies
    expect(results.length).toBe(0);
  });

  it('respects document ownership', async () => {
    const results = await semanticSearch({
      query: 'return policy',
      userId: otherUserId, // Different user
      correlationId,
    });

    // Should not find testUser's documents
    const hasTestUserDocs = results.some(
      r => r.documentId === testDocumentId
    );
    expect(hasTestUserDocs).toBe(false);
  });
});
