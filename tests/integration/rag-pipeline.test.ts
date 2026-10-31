import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { seedTestUser, seedTestDocument, deleteTestUsers } from "../helpers/seed";
import { generateToken } from "../helpers/auth";
import type * as FakeEmbedding from "../helpers/fake-embedding";
import type * as MockMcp from "../helpers/mock-mcp";

// Answer directly instead of routing low-confidence answers to human review.
// Hoisted so it runs before src/config reads the env.
vi.hoisted(() => {
  process.env.HITL_ENABLED = "false";
});

// Mock the LLM and embeddings at the service boundary
vi.mock("../../src/services/embedding.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await vi.importActual<typeof FakeEmbedding>("../helpers/fake-embedding")).fakeEmbeddingService
}));
vi.mock("../../src/services/mcp.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mcpComplete: (await vi.importActual<typeof MockMcp>("../helpers/mock-mcp")).mockMcpComplete
}));

// There is no create-conversation endpoint; conversations are created directly
async function createConversation(userId: string, title: string) {
  const conversation = await prisma.conversation.create({ data: { userId, title } });
  return conversation.id;
}

describe("RAG Pipeline Integration", () => {
  const userIds: string[] = [];
  let authToken: string;
  let userId: string;
  let documentId: string;

  beforeAll(async () => {
    const user = await seedTestUser({ tier: "pro" });
    userIds.push(user.id);
    userId = user.id;
    authToken = generateToken(user);
    documentId = await seedTestDocument("doc-product-spec", userId);
  });

  afterAll(async () => {
    // Conversations, messages, documents, chunks and usage logs cascade
    await deleteTestUsers(...userIds);
  });

  it("POST /api/v1/chat/:id/ask — full RAG query", async () => {
    const conversationId = await createConversation(userId, "Test conversation");

    // Send a question through the full pipeline
    const res = await request(app)
      .post(`/api/v1/chat/${conversationId}/ask`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ question: "What is the upload limit?", documentId });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("answer");
    expect(res.body.data).toHaveProperty("sources");
    expect(res.body.data).toHaveProperty("confidence");
    expect(typeof res.body.data.answer).toBe("string");
    expect(res.body.data.answer.length).toBeGreaterThan(0);
    expect(res.body.data.sources.length).toBeGreaterThan(0);
  });

  it("records usage log for chat messages", async () => {
    const conversationId = await createConversation(userId, "Usage tracking test");

    const res = await request(app)
      .post(`/api/v1/chat/${conversationId}/messages`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ content: "Summarize the document", documentId });

    expect(res.status).toBe(201);

    // Verify usage was logged
    const usageLogs = await prisma.usageLog.findMany({
      where: { userId, action: "chat" },
      orderBy: { createdAt: "desc" },
      take: 1
    });

    expect(usageLogs.length).toBe(1);
    expect(usageLogs[0]?.costUsd).toBeGreaterThan(0);
  });

  it("enforces the free-tier chat rate limit", async () => {
    const freeUser = await seedTestUser({ tier: "free" });
    userIds.push(freeUser.id);
    const freeToken = generateToken(freeUser);
    const freeDocId = await seedTestDocument("doc-product-spec", freeUser.id);
    const conversationId = await createConversation(freeUser.id, "Rate limit test");

    const ask = () =>
      request(app)
        .post(`/api/v1/chat/${conversationId}/ask`)
        .set("Authorization", `Bearer ${freeToken}`)
        .send({ question: "Test query", documentId: freeDocId });

    // Free tier gets 10 chat requests per minute
    for (let i = 0; i < 10; i++) {
      expect((await ask()).status).toBe(201);
    }

    const res = await ask();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });
});
