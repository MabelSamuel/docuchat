import { describe, it, expect } from 'vitest';
import { semanticSearch } from '../../src/services/search.service';

// IDs of seeded fixtures (test documents must already be ingested)
const testUserId = process.env.TEST_USER_ID ?? 'test-user';
const otherUserId = process.env.TEST_OTHER_USER_ID ?? 'other-user';
const testDocumentId = process.env.TEST_DOCUMENT_ID ?? 'test-document';
const correlationId = 'rag-test';

describe('RAG retrieval quality', () => {
  // Assume test documents are already ingested
  // with known content about specific topics

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
