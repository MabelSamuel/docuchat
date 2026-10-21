import { appEvents } from '../lib/events';
import { cacheDel } from '../lib/cache';
import { logger, serializeError } from '../lib/logger';

// When a role changes, bust the permissions cache for that user
appEvents.on('admin:role-assigned', async (data) => {
  try {
    await cacheDel(`permissions:${data.targetUserId}`);
    logger.debug('Permissions cache busted', { userId: data.targetUserId });
  } catch (error) {
    logger.error('Failed to bust permissions cache', {
      userId: data.targetUserId,
      error: serializeError(error),
    });
  }
});

appEvents.on('admin:role-revoked', async (data) => {
  try {
    await cacheDel(`permissions:${data.targetUserId}`);
  } catch (error) {
    logger.error('Failed to bust permissions cache', {
      userId: data.targetUserId,
      error: serializeError(error),
    });
  }
});

// When a document is updated or deleted, bust its cache
appEvents.on('doc:deleted', async (data) => {
  try {
    await cacheDel(`doc:${data.documentId}`);
  } catch (error) {
    logger.error('Failed to bust document cache', {
      documentId: data.documentId,
      error: serializeError(error),
    });
  }
});
