import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { documentsProcessed } from '../lib/metrics';

appEvents.on('doc:processed', async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'document_ingested',
        tokens: 0,
        costUsd: 0, // Will be updated by embedding events
        metadata: JSON.stringify({
          documentId: data.documentId,
          chunkCount: data.chunkCount,
          durationMs: data.durationMs,
          format: data.format,
          pageCount: data.pageCount,
        }),
      },
    });

    // Update Prometheus metric
    documentsProcessed.inc({ status: 'success' });

    logger.info('Ingestion logged', {
      documentId: data.documentId,
      chunkCount: data.chunkCount,
correlationId: data.correlationId
    });
  } catch (error) {
    logger.error('Failed to log ingestion:', error);
  }
});