import { createHash } from "crypto";

const DIMENSIONS = 1536; // Same as text-embedding-3-small, so pgvector accepts it

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "be", "do", "does", "did",
  "what", "who", "how", "we", "i", "you", "my", "your", "it", "this", "that",
  "of", "to", "for", "and", "or", "in", "on", "at", "by", "with", "about"
]);

// Deterministic stand-in for OpenAI embeddings. Each word is hashed into one
// dimension, so cosine similarity tracks keyword overlap: enough to exercise
// retrieval ranking and ownership filters without network calls.
export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const words = (text.toLowerCase().match(/[a-z0-9$]+/g) ?? [])
    .filter(w => !STOPWORDS.has(w))
    .map(w => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

  // A zero vector has no cosine similarity, so give empty text its own dimension
  for (const word of words.length > 0 ? words : ["<empty>"]) {
    const index = createHash("sha256").update(word).digest().readUInt32BE(0) % DIMENSIONS;
    vector[index]! += 1;
  }

  const norm = Math.hypot(...vector);
  return vector.map(v => v / norm);
}

// Spread over the real module in vi.mock so storage helpers stay real:
//   vi.mock("../../src/services/embedding.service", async (importOriginal) => ({
//     ...(await importOriginal<object>()),
//     ...(await vi.importActual<typeof FakeEmbedding>("../helpers/fake-embedding")).fakeEmbeddingService
//   }));
export const fakeEmbeddingService = {
  generateEmbedding: async (text: string) => fakeEmbedding(text),
  generateEmbeddingCached: async (text: string) => fakeEmbedding(text),
  generateEmbeddings: async (texts: string[]) => texts.map(fakeEmbedding),
  generateEmbeddingsBatchCached: async (texts: string[]) => texts.map(fakeEmbedding)
};
