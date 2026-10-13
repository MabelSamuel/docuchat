import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';

export const DOC_EVENTS = {
  CREATED: 'doc:created',
  PROCESSED: 'doc:processed',
  DELETED: 'doc:deleted',
} as const;

appEvents.on(DOC_EVENTS.CREATED, async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'document_created',
        tokens: 0,
        costUsd: 0,
        metadata: JSON.stringify({
          documentId: data.documentId,
          title: data.title,
          fileSizeBytes: data.fileSizeBytes,
        }),
      },
    });
  } catch (error) {
    console.error('Failed to log document creation:', error);
  }
});

appEvents.on(DOC_EVENTS.DELETED, async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.deletedBy,
        action: 'document_deleted',
        tokens: 0,
        costUsd: 0,
        metadata: JSON.stringify({
          documentId: data.documentId,
          title: data.title,
          deletedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    console.error('Failed to log document deletion:', error);
  }
});
