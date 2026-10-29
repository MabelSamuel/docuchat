import { prisma } from "../lib/prisma";
import { cacheGetOrSet, CACHE_TTL } from "../lib/cache";

// Whitelisted so arbitrary query strings can't mint unbounded cache keys
const PERIOD_MS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const;

export type MetricsPeriod = keyof typeof PERIOD_MS;
export const METRICS_PERIODS = Object.keys(PERIOD_MS) as MetricsPeriod[];

export function isMetricsPeriod(value: unknown): value is MetricsPeriod {
  return typeof value === 'string' && value in PERIOD_MS;
}

function computeSinceDate(period: MetricsPeriod): Date {
  return new Date(Date.now() - PERIOD_MS[period]);
}

// Dashboard reads go through Redis; metrics may be up to 5 minutes stale
export async function getCachedReviewMetrics(period: MetricsPeriod = '24h') {
  return cacheGetOrSet(
    `metrics:review:${period}`,
    CACHE_TTL.REVIEW_METRICS,
    () => getReviewMetrics(period)
  );
}

export async function getReviewMetrics(period: MetricsPeriod = '24h') {
  const since = computeSinceDate(period);

  const [total, pending, approved, rejected, escalated] = await Promise.all([
    prisma.reviewQueue.count({ where: { createdAt: { gte: since } } }),
    prisma.reviewQueue.count({ where: { status: 'PENDING' } }),
    prisma.reviewQueue.count({ where: { status: 'APPROVED', reviewedAt: { gte: since } } }),
    prisma.reviewQueue.count({ where: { status: 'REJECTED', reviewedAt: { gte: since } } }),
    prisma.reviewQueue.count({ where: { status: 'ESCALATED', escalatedAt: { gte: since } } }),
  ]);

  // Average turnaround time (created to reviewed)
  const reviewed = await prisma.reviewQueue.findMany({
    where: {
      reviewedAt: { not: null, gte: since },
    },
    select: { createdAt: true, reviewedAt: true },
  });

  const avgTurnaroundMs = reviewed.length > 0
    ? reviewed.reduce((sum, r) =>
        sum + (r.reviewedAt!.getTime() - r.createdAt.getTime()), 0
      ) / reviewed.length
    : 0;

  // Approval rate — how often do reviewers agree with the AI?
  const approvalRate = (approved + rejected) > 0
    ? approved / (approved + rejected)
    : 0;

  // Edit rate — how often do reviewers change the answer?
  const edited = await prisma.reviewQueue.count({
    where: {
      status: 'APPROVED',
      editedAnswer: { not: null },
      reviewedAt: { gte: since },
    },
  });
  const editRate = approved > 0 ? edited / approved : 0;

  // SLA compliance
  const slaBreaches = await prisma.reviewQueue.count({
    where: {
      status: 'ESCALATED',
      createdAt: { gte: since },
    },
  });
  const slaCompliance = total > 0 ? 1 - (slaBreaches / total) : 1;

  return {
    period,
    generatedAt: new Date().toISOString(),
    queue: { total, pending, approved, rejected, escalated },
    turnaround: {
      avgMinutes: Math.round(avgTurnaroundMs / 60000),
    },
    rates: {
      approvalRate: Math.round(approvalRate * 100),
      editRate: Math.round(editRate * 100),
      slaCompliance: Math.round(slaCompliance * 100),
      escalationRate: total > 0
        ? Math.round((escalated / total) * 100)
        : 0,
    },
  };
}
