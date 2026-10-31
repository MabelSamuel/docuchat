import { beforeAll, describe, expect, it, vi } from "vitest";
import { goldenDataset } from "../fixtures/golden-dataset";
import type * as FakeEmbedding from "../helpers/fake-embedding";
import { retrieveChunks } from "../helpers/rag";
import { seedTestDocument } from "../helpers/seed";

vi.mock("../../src/services/embedding.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await vi.importActual<typeof FakeEmbedding>("../helpers/fake-embedding")).fakeEmbeddingService
}));

function reciprocalRank(
  retrievedIds: string[],
  relevantIds: string[]
): number {
  const relevantSet = new Set(relevantIds);
  for (const [i, id] of retrievedIds.entries()) {
    if (relevantSet.has(id)) {
      return 1 / (i + 1);
    }
  }
  return 0; // No relevant chunk found
}

describe("RAG Relevance Scoring", () => {
  beforeAll(async () => {
    await seedTestDocument("doc-product-spec");
  });

  it("maintains MRR above 0.5 across golden dataset", async () => {
    const factualsAndComparisons = goldenDataset.filter(
      e => e.category !== "not-in-document"
    );

    let totalRR = 0;

    for (const entry of factualsAndComparisons) {
      const chunks = await retrieveChunks(
        entry.question,
        entry.documentId,
        { topK: 5 }
      );
      const rr = reciprocalRank(
        chunks.map(c => c.chunkId),
        entry.relevantChunkIds
      );
      totalRR += rr;
    }

    const mrr = totalRR / factualsAndComparisons.length;
    expect(mrr).toBeGreaterThanOrEqual(0.5);
  });
});
