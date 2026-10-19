import { openaiBreaker } from "../lib/http/openai.breaker";

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openaiBreaker.fire('/embeddings', {
    input: text,
    model: 'text-embedding-3-small',
  });
  return response.data.data[0].embedding;
}
