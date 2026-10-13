import { NotFoundError } from "../lib/errors";
import { prisma } from "../lib/prisma";

export async function listConversations(
  userId: string,
  options: { page: number; limit: number }
) {
  const { page, limit } = options;

  const [conversations, total] = await Promise.all([
    
    prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,  // Only the latest message
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
    data: conversations.map(conv => ({
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
}) {

  if (data.documentId) {
    const doc = await prisma.document.findFirst({
      where: { id: data.documentId, deletedAt: null },
    });
    if (!doc) {
      throw new NotFoundError('Document not found');
    }
  }

  return prisma.$transaction(async (tx) => {

    // 1. Verify the conversation belongs to this user
    const conversation = await tx.conversation.findFirst({
      where: { id: data.conversationId, userId: data.userId },
    });

    if (!conversation) {
      throw new NotFoundError('Conversation not found');
    }

    // 2. Create the user's message
    const userMessage = await tx.message.create({
      data: {
        conversationId: data.conversationId,
        documentId: data.documentId ?? null,
        role: 'user',
        content: data.content,
      },
    });

    // 3. Touch the conversation's updatedAt
    await tx.conversation.update({
      where: { id: data.conversationId },
      data: { updatedAt: new Date() },
    });

    // 4. In Week 4, this is where the RAG pipeline runs.
    //    For now, we'll create a placeholder assistant message.
    const assistantMessage = await tx.message.create({
      data: {
        conversationId: data.conversationId,
        documentId: data.documentId ?? null,
        role: 'assistant',
        content: 'AI response placeholder (Week 4)',
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
      },
    });

    // 5. Log usage
    await tx.usageLog.create({
      data: {
        userId: data.userId,
        action: 'chat',
        tokens: 0,  // Placeholder until Week 4
        costUsd: 0,
      },
    });

    return { userMessage, assistantMessage };
  });
}

