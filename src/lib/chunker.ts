export function splitIntoChunks(
  text: string,
  maxWordsPerChunk: number = 500
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += maxWordsPerChunk) {
    const chunk = words.slice(i, i + maxWordsPerChunk).join(' ');
    if (chunk.trim()) chunks.push(chunk);
  }

  return chunks.length > 0 ? chunks : [text];
}

export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ~= 0.75 words
  return Math.ceil(text.split(/\s+/).length * 1.33);
}