import type { ReviewPriority, ReviewQueue, ReviewStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { NotFoundError } from '../lib/errors';

export const reviewQueueService = {
  async list(filter: {
    status?: ReviewStatus | undefined;
    page: number;
    limit: number;
  }) {
    const { status, page, limit } = filter;
    const where = status ? { status } : {};

    const [items, total] = await Promise.all([
      prisma.reviewQueue.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reviewQueue.count({ where }),
    ]);

    return { data: items, meta: { page, limit, total } };
  },

  async getById(reviewId: string) {
    const review = await prisma.reviewQueue.findUnique({
      where: { id: reviewId },
      include: { document: { select: { id: true, title: true } } },
    });
    if (!review) throw new NotFoundError('Review not found');
    return review;
  },

  async enqueue(data: {
    messageId: string;
    documentId: string;
    question: string;
    generatedAnswer: string;
    confidence: number;
    sources: any;
    reason?: string | undefined;
  }) {
    const priority = this.computePriority(data.confidence);
    const slaDeadline = new Date(
      Date.now() + config.hitl.slaMinutes * 60 * 1000
    );

    return prisma.reviewQueue.create({
      data: {
        ...data,
        reason: data.reason ?? null,
        priority,
        slaDeadline,
      },
    });
  },

  // Claim the next item for review (FIFO within priority)
  async claimNext(reviewerId: string) {
    // Use a transaction to prevent two reviewers
    // from claiming the same item
    return prisma.$transaction(async (tx) => {
      const item = await tx.reviewQueue.findFirst({
        where: { status: 'PENDING' },
        orderBy: [
          { priority: 'desc' },  // URGENT first
          { createdAt: 'asc' },  // oldest first within priority
        ],
      });

      if (!item) return null;

      return tx.reviewQueue.update({
        where: { id: item.id },
        data: {
          status: 'IN_REVIEW',
          reviewedBy: reviewerId,
        },
      });
    });
  },

  async processDecision(
    reviewId: string,
    reviewerId: string,
    decision: {
      action: 'approve' | 'reject';
      editedAnswer?: string | undefined;
      reviewerNotes?: string | undefined;
    }
  ) {
    const review = await prisma.reviewQueue.update({
      where: { id: reviewId },
      data: {
        status: decision.action === 'approve' ? 'APPROVED' : 'REJECTED',
        reviewedBy: reviewerId,
        editedAnswer: decision.editedAnswer ?? null,
        reviewerNotes: decision.reviewerNotes ?? null,
        reviewedAt: new Date(),
      },
    });

    // Update the original message with the final answer
    if (decision.action === 'approve') {
      const finalAnswer = decision.editedAnswer || review.generatedAnswer;
      await prisma.message.update({
        where: { id: review.messageId },
        data: {
          content: finalAnswer,
          // Mark it as human-reviewed so we know
          // this answer was validated
          metadata: { humanReviewed: true, reviewId },
        },
      });
    }

    // Store the feedback for future improvement
    await this.storeFeedback(review, decision);

    return review;
  },

  computePriority(confidence: number): ReviewPriority {
    if (confidence < 0.2) return 'URGENT';
    if (confidence < 0.4) return 'HIGH';
    if (confidence < 0.6) return 'NORMAL';
    return 'LOW';
  },

  async storeFeedback(
    review: ReviewQueue,
    decision: {
      action: string;
      editedAnswer?: string | undefined;
      reviewerNotes?: string | undefined;
    }
  ) {
    // This is the feedback loop. Every human decision
    // becomes a data point you can use to improve the system.
    // Full answers stay on the ReviewQueue row; the audit log
    // gets a searchable summary (same pattern as auditToolCall).
    const wasEdited = !!decision.editedAnswer;
    await prisma.aIAuditLog.create({
      data: {
        userId: review.reviewedBy!,
        correlationId: `review_${review.id}`,
        taskType: 'hitl_review',
        model: 'human',
        promptVersion: 'n/a',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: review.reviewedAt
          ? review.reviewedAt.getTime() - review.createdAt.getTime()
          : 0,
        inputSummary: review.question.substring(0, 500),
        outputSummary: (
          `[${decision.action}${wasEdited ? ', edited' : ''}] ` +
          `confidence=${review.confidence} ` +
          (decision.reviewerNotes ?? '')
        ).substring(0, 500),
      },
    });
  },
};
