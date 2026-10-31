import { randomUUID } from "crypto";
import { prisma } from "../../src/lib/prisma";
import { generateEmbeddings, storeChunkEmbeddingsBatch } from "../../src/services/embedding.service";
import { documentFixtures, type DocumentFixtureId } from "../fixtures/documents";

// Owns the shared golden-dataset document
export const GOLDEN_OWNER_ID = "test-user-golden";

export async function seedTestUser(options: { id?: string; tier?: string } = {}) {
  // Same default role registration assigns; it carries conversations:create
  const defaultRole = await prisma.role.findFirst({ where: { isDefault: true } });
  if (!defaultRole) {
    throw new Error("No default role found. Run `npx prisma db seed` against the test database first.");
  }

  const id = options.id ?? `test-user-${randomUUID()}`;
  const tier = options.tier ?? "free";

  // Upsert so fixed IDs survive a previous run that crashed before cleanup
  return prisma.user.upsert({
    where: { id },
    update: { tier },
    create: {
      id,
      name: "Test User",
      email: `${id}@test.docuchat.local`,
      passwordHash: "not-a-real-hash",
      tier,
      roles: { create: { roleId: defaultRole.id } }
    }
  });
}

export async function deleteTestUsers(...ids: string[]) {
  // Documents, chunks, conversations, memories and usage logs cascade
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Seeds a fixture document with embedded chunks and returns its ID.
 *
 * Without a userId this (re)creates the shared golden copy, whose document
 * and chunk IDs match the golden dataset. Re-seeding every time keeps the
 * stored vectors in step with whichever embedder the test file uses.
 * With a userId it creates a private copy with generated IDs.
 */
export async function seedTestDocument(fixtureId: DocumentFixtureId, userId?: string): Promise<string> {
  const fixture = documentFixtures[fixtureId];
  const shared = userId === undefined;
  const ownerId = userId ?? (await seedTestUser({ id: GOLDEN_OWNER_ID })).id;

  if (shared) {
    await prisma.document.deleteMany({ where: { id: fixtureId } });
  }

  const document = await prisma.document.create({
    data: {
      ...(shared ? { id: fixtureId } : {}),
      userId: ownerId,
      title: fixture.title,
      content: fixture.chunks.map(c => c.content).join("\n\n"),
      status: "ready",
      chunkCount: fixture.chunks.length,
      chunks: {
        create: fixture.chunks.map((chunk, index) => ({
          ...(shared ? { id: chunk.id } : {}),
          index,
          content: chunk.content,
          tokenCount: Math.ceil(chunk.content.length / 4)
        }))
      }
    },
    include: { chunks: { orderBy: { index: "asc" } } }
  });

  const embeddings = await generateEmbeddings(
    document.chunks.map(c => c.content),
    { userId: ownerId, documentId: document.id }
  );
  await storeChunkEmbeddingsBatch(
    document.chunks.map((chunk, i) => ({ id: chunk.id, embedding: embeddings[i]! }))
  );

  return document.id;
}
