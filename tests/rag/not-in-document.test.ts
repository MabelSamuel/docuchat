import { beforeAll, describe, expect, it, vi } from "vitest";
import { goldenDataset } from "../fixtures/golden-dataset";
import type * as FakeEmbedding from "../helpers/fake-embedding";
import type * as MockMcp from "../helpers/mock-mcp";
import { queryDocument } from "../helpers/rag";
import { seedTestDocument } from "../helpers/seed";

vi.mock("../../src/services/embedding.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await vi.importActual<typeof FakeEmbedding>("../helpers/fake-embedding")).fakeEmbeddingService
}));
vi.mock("../../src/services/mcp.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mcpComplete: (await vi.importActual<typeof MockMcp>("../helpers/mock-mcp")).mockMcpComplete
}));

describe("Not-in-document handling", () => {
  beforeAll(async () => {
    await seedTestDocument("doc-product-spec");
  });

  it.each(
    goldenDataset.filter(e => e.category === "not-in-document")
  )("refuses to answer: $question", async (entry) => {
    const result = await queryDocument(entry.question, entry.documentId);

    // The response should indicate the document doesn't contain the answer
    // Check either:
    // 1. The confidence score is below threshold
    // 2. The response explicitly states information not found
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.answer).toMatch(
      /not (found|mentioned|covered|available)|no information|cannot (find|answer)/i
    );
  });

  it("does not hallucinate when retrieval returns low-similarity chunks", async () => {
    // Ask something completely unrelated to the test document
    const result = await queryDocument(
      "What is the recipe for chocolate cake?",
      "doc-product-spec"
    );

    expect(result.confidence).toBeLessThan(0.2);
    // The answer should NOT contain recipe-like content
    expect(result.answer.toLowerCase()).not.toMatch(
      /ingredients|preheat|bake|flour|sugar/
    );
  });
});
