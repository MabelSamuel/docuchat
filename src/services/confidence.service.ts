// Only the similarity score matters, so any search result shape fits
interface ScoredChunk {
  score: number; // cosine similarity from pgvector
}

export interface ConfidenceResult {
  score: number; // 0 to 1
  level: "high" | "medium" | "low" | "none";
  shouldEscalate: boolean;
  reason?: string | undefined;
}

export function computeConfidence(
  chunks: ScoredChunk[],
  threshold: number = 0.6,
): ConfidenceResult {
  // No chunks retrieved at all — the document probably
  // does not contain information relevant to this question
  if (chunks.length === 0) {
    return {
      score: 0,
      level: "none",
      shouldEscalate: true,
      reason: "No relevant chunks found in document",
    };
  }

  // Weighted average: rank 1 gets weight 5, rank 2 gets 4, etc.
  const weights = chunks.map((_, i) => chunks.length - i);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const weightedScore =
    chunks.reduce((sum, chunk, i) => sum + chunk.score * weights[i]!, 0) /
    totalWeight;

  // Classify the confidence level
  let level: ConfidenceResult["level"];
  let reason: string | undefined;

  if (weightedScore >= 0.85) {
    level = "high";
  } else if (weightedScore >= threshold) {
    level = "medium";
  } else if (weightedScore >= 0.3) {
    level = "low";
    reason =
      `Retrieval confidence ${(weightedScore * 100).toFixed(0)}% ` +
      `below threshold ${(threshold * 100).toFixed(0)}%`;
  } else {
    level = "none";
    reason = "Retrieved chunks are not relevant to the question";
  }

  return {
    score: Math.round(weightedScore * 100) / 100,
    level,
    shouldEscalate: weightedScore < threshold,
    reason,
  };
}
