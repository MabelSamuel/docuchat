import type { ReviewQueue } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { appEvents } from '../lib/events';
import { logger } from '../lib/logger';
import { config } from '../config';

export const REVIEW_EVENTS = {
  ESCALATED: 'review:escalated',
  SLA_BREACHED: 'review:sla_breached',
} as const;

const OPEN_STATUSES = ['PENDING', 'IN_REVIEW'] as const;
const WARNING_WINDOW_MS = 15 * 60 * 1000; // Escalate 15 minutes before SLA

// Runs every 5 minutes via the repeatable job in queues/escalation.queue.ts
export async function checkEscalations() {
  if (!config.hitl.escalationEnabled) return;

  const now = new Date();
  const warningWindow = new Date(now.getTime() + WARNING_WINDOW_MS);

  // Breached items are handled whether or not they were escalated earlier,
  // otherwise an item escalated in the warning window would never be resolved
  const breached = await prisma.reviewQueue.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      slaDeadline: { lte: now },
    },
    orderBy: { slaDeadline: 'asc' },
  });

  const atRisk = await prisma.reviewQueue.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      slaDeadline: { gt: now, lte: warningWindow },
      escalatedAt: null,
    },
    orderBy: { slaDeadline: 'asc' },
  });

  for (const item of breached) await handleSlaBreach(item);
  for (const item of atRisk) await escalateItem(item);

  if (breached.length || atRisk.length) {
    logger.info({
      event: 'escalations:checked',
      breached: breached.length,
      escalated: atRisk.length,
    });
  }
}

function waitTimeMinutes(item: ReviewQueue) {
  return Math.round((Date.now() - item.createdAt.getTime()) / 60000);
}

async function escalateItem(item: ReviewQueue) {
  // Conditional update so we don't touch an item a reviewer just closed
  const { count } = await prisma.reviewQueue.updateMany({
    where: { id: item.id, status: { in: [...OPEN_STATUSES] }, escalatedAt: null },
    data: { priority: 'URGENT', escalatedAt: new Date() },
  });
  if (count === 0) return;

  // Notify admins via the event system
  appEvents.emit(REVIEW_EVENTS.ESCALATED, {
    reviewId: item.id,
    question: item.question,
    confidence: item.confidence,
    slaDeadline: item.slaDeadline,
    waitTimeMinutes: waitTimeMinutes(item),
  });
}

async function handleSlaBreach(item: ReviewQueue) {
  const closed = await prisma.$transaction(async (tx) => {
    // Claim the item first; if a reviewer approved/rejected it in the
    // meantime, leave their answer alone
    const { count } = await tx.reviewQueue.updateMany({
      where: { id: item.id, status: { in: [...OPEN_STATUSES] } },
      data: { status: 'ESCALATED', escalatedAt: item.escalatedAt ?? new Date() },
    });
    if (count === 0) return false;

    // Deliver the original answer with a low-confidence disclaimer
    await tx.message.update({
      where: { id: item.messageId },
      data: {
        content: item.generatedAnswer,
        metadata: {
          humanReviewed: false,
          disclaimer:
            'This answer was generated with low confidence ' +
            'and could not be reviewed in time. ' +
            'Please verify the information independently.',
          slaBreach: true,
        },
      },
    });
    return true;
  });
  if (!closed) return;

  appEvents.emit(REVIEW_EVENTS.SLA_BREACHED, {
    reviewId: item.id,
    waitTimeMinutes: waitTimeMinutes(item),
  });
}
