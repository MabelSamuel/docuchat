import { config } from '../config';
import { NotFoundError } from '../lib/errors';
import { logger, serializeError } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { computeConfidence } from './confidence.service';
import { conversationMemory } from './conversation-memory.service';
import { memoryExtractor } from './memory-extractor.service';
import { memoryService } from './memory.service';
import { assembleContext, generateRAGResponse } from './rag.service';
import { reviewQueueService } from './review-queue.service';
import { semanticSearch } from './search.service';

export async function askQuestion(data: {
  documentId: string;
  question: string;
  userId: string;
  conversationId: string;
  correlationId: string;
}) {
  const { documentId, question, userId, conversationId, correlationId } = data;
  const askedAt = new Date();

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!conversation) throw new NotFoundError('Conversation not found');

  // 1-3. Load conversation context, long-term memories and document chunks
  //      in parallel. Memory is an enhancement: if it fails, answer without it.
  const [conversationCtx, longTermMemories, chunks] = await Promise.all([
    conversationMemory.buildContext(conversationId),
    memoryService.retrieve(userId, question, 5).catch((error) => {
      logger.warn('Memory retrieval failed, continuing without it', {
        correlationId,
        error: serializeError(error),
      });
      return [];
    }),
    semanticSearch({
      query: question,
      userId,
      documentId,
      topK: 5,
      correlationId,
    }),
  ]);

  // 4. Compute confidence before calling the LLM
  const confidence = computeConfidence(chunks, config.hitl.confidenceThreshold);

  // 5. Call the LLM regardless — we need the answer
  //    even if it goes to review (reviewers need to see it)
  const context = assembleContext(chunks);
  const answer = await generateRAGResponse({
    question,
    context,
    conversationHistory: conversationCtx.recentMessages,
    conversationSummary: conversationCtx.summary,
    longTermMemories,
    userId,
    conversationId,
    correlationId,
  });

  // 6. Store both sides of the exchange so conversation memory sees them.
  //    The user message is backdated to when it was asked, which keeps
  //    ordering stable (createdAt only has millisecond precision).
  const [, message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        documentId,
        role: 'user',
        content: question,
        createdAt: askedAt,
      },
    }),
    prisma.message.create({
      data: {
        conversationId,
        documentId,
        role: 'assistant',
        content: answer.answer,
        promptTokens: answer.tokensUsed.prompt,
        completionTokens: answer.tokensUsed.completion,
        costUsd: answer.costUsd,
        metadata: {
          model: answer.model,
          citations: answer.citations as any,
          confidence: confidence.score,
          memoriesUsed: longTermMemories.map((m) => m.id),
          contextStrategy: conversationCtx.strategy,
        },
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);

  // 7. Extract new memories in the background — never block or fail the response
  memoryExtractor
    .extractFromInteraction(userId, question, answer.answer, correlationId)
    .catch((error) => {
      logger.error('Memory extraction failed', {
        correlationId,
        userId,
        error: serializeError(error),
      });
    });

  // 8. Route based on confidence
  if (confidence.shouldEscalate && config.hitl.escalationEnabled) {
    await reviewQueueService.enqueue({
      messageId: message.id,
      documentId,
      question,
      generatedAnswer: answer.answer,
      confidence: confidence.score,
      sources: answer.citations,
      reason: confidence.reason,
    });

    return {
      messageId: message.id,
      status: 'under_review',
      message: 'This answer is being reviewed for accuracy. ' +
               'You will be notified when the review is complete.',
      confidence: confidence.score,
      conversationId,
    };
  }

  // 9. High confidence — return directly
  return {
    messageId: message.id,
    question,
    answer: answer.answer,
    sources: answer.citations,
    confidence: confidence.score,
    usage: answer.tokensUsed,
    conversationId,
  };
}
