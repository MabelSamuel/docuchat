import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryType } from "@prisma/client";
import { memoryService } from "../../src/services/memory.service";
import { prisma } from "../../src/lib/prisma";
import type * as FakeEmbedding from "../helpers/fake-embedding";
import { deleteTestUsers, seedTestUser } from "../helpers/seed";

vi.mock("../../src/services/embedding.service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await vi.importActual<typeof FakeEmbedding>("../helpers/fake-embedding")).fakeEmbeddingService
}));

describe("Memory Retrieval Accuracy", () => {
  const testUserId = "user-test-001";

  beforeAll(async () => {
    await seedTestUser({ id: testUserId });
  });

  afterAll(async () => {
    await deleteTestUsers(testUserId);
  });

  beforeEach(async () => {
    // Clean slate for each test
    await prisma.memory.deleteMany({
      where: { userId: testUserId }
    });
  });

  it("retrieves a recently stored memory", async () => {
    // Store a memory from a conversation about pricing
    await memoryService.store({
      userId: testUserId,
      source: "conversation:conv-test-001",
      content: "User asked about pricing. Pro tier costs $29/month. User expressed interest in annual billing.",
      type: MemoryType.FACT
    });

    // Query with a related question
    const memories = await memoryService.retrieve(testUserId, "What did we discuss about pricing?", 5);

    expect(memories.length).toBeGreaterThanOrEqual(1);
    // The stored memory should appear in results
    const pricingMemory = memories.find(m =>
      m.content.includes("pricing") || m.content.includes("Pro tier")
    );
    expect(pricingMemory).toBeDefined();
  });

  it("ranks more relevant memories higher", async () => {
    // Store multiple memories about different topics
    await memoryService.store({
      userId: testUserId,
      source: "conversation:conv-test-001",
      content: "User uploaded a technical specification PDF about API design.",
      type: MemoryType.FACT
    });

    await memoryService.store({
      userId: testUserId,
      source: "conversation:conv-test-002",
      content: "User asked about pricing and billing options for the Pro tier.",
      type: MemoryType.FACT
    });

    await memoryService.store({
      userId: testUserId,
      source: "conversation:conv-test-003",
      content: "User requested help understanding rate limiting in their document.",
      type: MemoryType.FACT
    });

    // Query about pricing — the pricing memory should rank first
    const memories = await memoryService.retrieve(testUserId, "billing and pricing", 3);

    expect(memories.length).toBe(3);
    expect(memories[0]?.content).toMatch(/pricing|billing/i);
  });

  it("returns no relevant memories for an unrelated query", async () => {
    await memoryService.store({
      userId: testUserId,
      source: "conversation:conv-test-001",
      content: "User discussed API design patterns.",
      type: MemoryType.FACT
    });

    const memories = await memoryService.retrieve(testUserId, "quantum physics", 5);

    // Either empty or all below relevance threshold
    const relevant = memories.filter(m => m.similarity > 0.5);
    expect(relevant.length).toBe(0);
  });
});
