import { NotFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { assembleContext, generateRAGResponse } from "./rag.service";
import { semanticSearch } from "./search.service";

export async function listConversations(
  userId: string,
  options: { page: number; limit: number },
) {
  const { page, limit } = options;

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1, // Only the latest message
          select: {
            content: true,
            role: true,
            createdAt: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    }),

    prisma.conversation.count({ where: { userId } }),
  ]);

  return {
    data: conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      messageCount: conv._count.messages,
      lastMessage: conv.messages[0] || null,
      updatedAt: conv.updatedAt,
    })),
    meta: {
      page,
      limit,
      total,
    },
  };
}

export async function sendMessage(data: {
  conversationId: string;
  userId: string;
  content: string;
  documentId?: string;
  correlationId: string;
}) {
  if (data.documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: data.documentId, deletedAt: null },
    });
    if (!doc) {
      throw new NotFoundError("Document not found");
    }
  }

  return prisma.$transaction(async (tx) => {
    // 1. Verify the conversation belongs to this user
    const conversation = await tx.conversation.findFirst({
      where: { id: data.conversationId, userId: data.userId },
    });

    if (!conversation || conversation.userId !== data.userId) {
      throw new NotFoundError("Conversation not found");
    }

    // 2. Create the user's message
    const userMessage = await tx.message.create({
      data: {
        conversationId: data.conversationId,
        documentId: data.documentId ?? null,
        role: "user",
        content: data.content,
      },
    });

    // 3. Load recent conversation history
    const history = await tx.message.findMany({
      where: { conversationId: data.conversationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { role: true, content: true },
    });
    const conversationHistory = history.reverse();

    // 4. RAG: Retrieve
    const searchResults = await semanticSearch({
      query: data.content,
      userId: data.userId,
      documentId: data.documentId,
      correlationId: data.correlationId,
    });

    // 5. RAG: Augment
    const context = assembleContext(searchResults);

    // 6. RAG: Generate
    const ragResponse = await generateRAGResponse({
      question: data.content,
      context,
      conversationHistory,
      userId: data.userId,
      conversationId: data.conversationId,
      correlationId: data.correlationId,
    });

    // 7. Save assistant message with metadata
    const assistantMessage = await tx.message.create({
      data: {
        conversationId: data.conversationId,
        documentId: data.documentId ?? null,
        role: "assistant",
        content: ragResponse.answer,
        promptTokens: ragResponse.tokensUsed.prompt,
        completionTokens: ragResponse.tokensUsed.completion,
        costUsd: ragResponse.costUsd,
        metadata: JSON.stringify({
          model: ragResponse.model,
          citations: ragResponse.citations,
          contextChunks: context.chunks.length,
        }),
      },
    });

    // 8. Touch the conversation's updatedAt
    await tx.conversation.update({
      where: { id: data.conversationId },
      data: { updatedAt: new Date() },
    });
    // 5. Log usage
    await tx.usageLog.create({
      data: {
        userId: data.userId,
        action: "chat",
        tokens: 0, 
        costUsd: ragResponse.costUsd,
      },
    });

    return {
      userMessage,
      assistantMessage: {
        ...assistantMessage,
        citations: ragResponse.citations,
      },
    };
  });
}
