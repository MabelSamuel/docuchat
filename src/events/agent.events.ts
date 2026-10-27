import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

appEvents.on('agent:completed', async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'agent_run',
        tokens: data.totalTokens,
        costUsd: data.totalCostUsd,
        metadata: JSON.stringify({
          correlationId: data.correlationId,
          iterations: data.iterations,
          terminationReason: data.terminationReason,
          toolsUsed: data.toolsUsed,
          confidence: data.confidence,
          durationMs: data.durationMs,
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log agent run:', error);
  }
});