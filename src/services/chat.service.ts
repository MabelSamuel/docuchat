import { config } from '../config';
import { NotFoundError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { computeConfidence } from './confidence.service';
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

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!conversation) throw new NotFoundError('Conversation not found');

  // 1-2. Embed the question and retrieve top-5 chunks from pgvector
  const chunks = await semanticSearch({
    query: question,
    userId,
    documentId,
    topK: 5,
    correlationId,
  });

  // 3. Compute confidence before calling the LLM
  const confidence = computeConfidence(chunks, config.hitl.confidenceThreshold);

  // 4. Call the LLM regardless — we need the answer
  //    even if it goes to review (reviewers need to see it)
  const context = assembleContext(chunks);
  const answer = await generateRAGResponse({
    question,
    context,
    userId,
    conversationId,
    correlationId,
  });

  // 5. Store the message
  const message = await prisma.message.create({
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
      },
    },
  });

  // 6. Route based on confidence
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

  // 7. High confidence — return directly
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
