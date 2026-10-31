import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { mcpComplete } from '../services/mcp.service';
import { estimateTokens } from '../lib/chunker';

interface ConversationContext {
  recentMessages: Array<{ role: string; content: string }>;
  summary: string | null;
  totalTokens: number;
  strategy: 'full' | 'windowed' | 'summarized';
}

const DEFAULTS = {
  maxContextTokens: 4000,  // budget for conversation context
  windowSize: 6,           // keep last N messages
  summarizeThreshold: 10,  // summarize when history exceeds this
};

export const conversationMemory = {
  async buildContext(
    conversationId: string,
    config = DEFAULTS
  ): Promise<ConversationContext> {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    if (messages.length === 0) {
      return {
        recentMessages: [],
        summary: null,
        totalTokens: 0,
        strategy: 'full',
      };
    }

    // If everything fits in the budget, return it all
    const totalTokens = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content), 0
    );

    if (totalTokens <= config.maxContextTokens) {
      return {
        recentMessages: messages,
        summary: null,
        totalTokens,
        strategy: 'full',
      };
    }

    // Window the recent messages
    const recent = messages.slice(-config.windowSize);
    const older = messages.slice(0, -config.windowSize);

    // If we have older messages, summarize them
    let summary: string | null = null;
    if (older.length > 0) {
      summary = await this.getOrCreateSummary(
        conversationId, older
      );
    }

    const recentTokens = recent.reduce(
      (sum, m) => sum + estimateTokens(m.content), 0
    );
    const summaryTokens = summary ? estimateTokens(summary) : 0;

    return {
      recentMessages: recent,
      summary,
      totalTokens: recentTokens + summaryTokens,
      strategy: summary ? 'summarized' : 'windowed',
    };
  },

  async getOrCreateSummary(
    conversationId: string,
    olderMessages: Array<{ role: string; content: string }>
  ): Promise<string> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, summary: true, messageCount: true },
    });

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // If summary exists and is up to date, reuse it
    const totalMessages = olderMessages.length;
    if (
      conversation.summary &&
      conversation.messageCount >= totalMessages
    ) {
      return conversation.summary;
    }

    // Generate a new summary
    const transcript = olderMessages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');

    const response = await mcpComplete({
      taskType: 'summary',
      userId: conversation.userId,
      correlationId: randomUUID(),
      messages: [
        {
          role: 'system',
          content: `Summarize this conversation concisely.
Capture:
1. Key topics discussed and conclusions reached
2. Specific facts, numbers, and claims (exact values)
3. Any corrections the user made
4. User preferences expressed (answer format, detail level)

Be factual and specific. Do not generalize.`,
        },
        { role: 'user', content: transcript },
      ],
    });

    const summary = response.content;

    // Persist the summary for reuse
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        summary,
        summaryTokens: estimateTokens(summary),
        messageCount: totalMessages,
      },
    });

    return summary;
  },
};

