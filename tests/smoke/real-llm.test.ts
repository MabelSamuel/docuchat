import { describe, it, expect } from "vitest";
import { assembleContext, generateRAGResponse } from "../../src/services/rag.service";
import { retrieveChunks } from "../helpers/rag";
import { GOLDEN_OWNER_ID, seedTestDocument } from "../helpers/seed";

// Only run when SMOKE_TEST=true is set
const runSmoke = process.env.SMOKE_TEST === "true";

describe.skipIf(!runSmoke)("Smoke Tests (Real LLM)", () => {
  it("generates a coherent answer from real embeddings and real LLM", async () => {
    const docId = await seedTestDocument("doc-product-spec");

    const chunks = await retrieveChunks(
      "What is the upload limit?",
      docId,
      { topK: 3 }
    );

    expect(chunks.length).toBeGreaterThan(0);

    const answer = await generateRAGResponse({
      question: "What is the upload limit?",
      context: assembleContext(chunks),
      userId: GOLDEN_OWNER_ID,
      conversationId: "smoke-test",
      correlationId: "smoke-test"
    });

    expect(typeof answer.answer).toBe("string");
    expect(answer.answer.length).toBeGreaterThan(20);
    // Basic sanity: answer should reference the topic
    expect(answer.answer.toLowerCase()).toMatch(/upload|file|size|limit|mb/);
  }, 30000); // 30 second timeout for real API calls
});
