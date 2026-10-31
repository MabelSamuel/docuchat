import { describe, it, expect, beforeAll, vi } from "vitest";
import { goldenDataset } from "../fixtures/golden-dataset";
import type * as FakeEmbedding from "../helpers/fake-embedding";
import { retrieveChunks } from "../helpers/rag";
import { seedTestDocument } from "../helpers/seed";

vi.mock("../../src/services/embedding.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await vi.importActual<typeof FakeEmbedding>("../helpers/fake-embedding")).fakeEmbeddingService
}));

describe("RAG Retrieval Quality", () => {
  beforeAll(async () => {
    // Seed the vector store with the golden dataset's document
    await seedTestDocument("doc-product-spec");
  });

  function measureRetrieval(
    retrieved: string[],
    relevant: string[]
  ) {
    if (relevant.length === 0) return { precision: 1, recall: 1 };

    const retrievedSet = new Set(retrieved);
    const relevantSet = new Set(relevant);
    const truePositives = relevant.filter(id => retrievedSet.has(id)).length;

    return {
      precision: retrieved.length > 0 ? truePositives / retrieved.length : 0,
      recall: truePositives / relevantSet.size
    };
  }

  it.each(
    goldenDataset.filter(e => e.category !== "not-in-document")
  )("retrieves relevant chunks for: $question", async (entry) => {
    const chunks = await retrieveChunks(entry.question, entry.documentId, {
      topK: 5
    });

    const retrievedIds = chunks.map(c => c.chunkId);
    const { precision, recall } = measureRetrieval(
      retrievedIds,
      entry.relevantChunkIds
    );

    // Recall is more important than precision for RAG
    // Missing evidence = wrong answers
    // Extra context = slower but usually still correct
    expect(recall).toBeGreaterThanOrEqual(0.6);
    expect(precision).toBeGreaterThanOrEqual(0.3);
  });

  it.each(
    goldenDataset.filter(e => e.category !== "not-in-document")
  )("does not retrieve irrelevant chunks for: $question", async (entry) => {
    if (entry.irrelevantChunkIds.length === 0) return;

    const chunks = await retrieveChunks(entry.question, entry.documentId, {
      topK: 5
    });
    const retrievedIds = new Set(chunks.map(c => c.chunkId));

    for (const badId of entry.irrelevantChunkIds) {
      expect(retrievedIds.has(badId)).toBe(false);
    }
  });
});
