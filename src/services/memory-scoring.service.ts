export function computeImportance(memory: {
  type: string;
  accessCount: number;
  lastAccessedAt: Date | null;
  createdAt: Date;
}): number {
  let score = 0;

  // Type baseline: corrections matter most
  const typeWeights: Record<string, number> = {
    CORRECTION: 0.9,
    FACT: 0.6,
    PREFERENCE: 0.5,
    PATTERN: 0.3,
  };
  score += typeWeights[memory.type] || 0.3;

  // Recency boost: recently accessed memories are more relevant
  if (memory.lastAccessedAt) {
    const daysSinceAccess = Math.floor(
      (Date.now() - memory.lastAccessedAt.getTime()) / 86400000
    );
    if (daysSinceAccess < 1) score += 0.1;
    else if (daysSinceAccess < 7) score += 0.05;
    // No boost for memories not accessed in over a week
  }

  // Frequency boost: memories accessed often are probably important
  if (memory.accessCount > 10) score += 0.05;
  if (memory.accessCount > 50) score += 0.05;

  return Math.min(score, 1.0);
}
