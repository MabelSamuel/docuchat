import { appEvents } from '../lib/events';
import { cacheDel } from '../lib/cache';

// When a role changes, bust the permissions cache for that user
appEvents.on('admin:role-assigned', async (data) => {
  try {
    await cacheDel(`permissions:${data.targetUserId}`);
    console.log(`Cache busted: permissions for ${data.targetUserId}`);
  } catch (error) {
    console.error('Failed to bust permissions cache:', error);
  }
});

appEvents.on('admin:role-revoked', async (data) => {
  try {
    await cacheDel(`permissions:${data.targetUserId}`);
  } catch (error) {
    console.error('Failed to bust permissions cache:', error);
  }
});

// When a document is updated or deleted, bust its cache
appEvents.on('doc:deleted', async (data) => {
  try {
    await cacheDel(`doc:${data.documentId}`);
  } catch (error) {
    console.error('Failed to bust document cache:', error);
  }
});
