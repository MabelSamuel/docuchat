import './lib/config'; // Load and validate env vars first
import { logger, serializeError } from './lib/logger';
import { prisma } from './lib/prisma';
import { redisConnection } from './queues/connection';

// The worker emits 'doc:processed', so its listeners must live in this process too
import './events/document.events';

import { worker } from './queues/document.worker';
import { escalationWorker } from './queues/escalation.worker';
import { escalationQueue, scheduleEscalationChecks } from './queues/escalation.queue';
import { memoryCleanupWorker } from './queues/memory-cleanup.worker';
import { memoryCleanupQueue, scheduleMemoryCleanup } from './queues/memory-cleanup.queue';

logger.info({ event: 'worker:started', queue: worker.name });
logger.info({ event: 'worker:started', queue: escalationWorker.name });
logger.info({ event: 'worker:started', queue: memoryCleanupWorker.name });


scheduleEscalationChecks().catch((error) => {
  logger.error('Failed to schedule escalation checks', { error: serializeError(error) });
});
scheduleMemoryCleanup().catch((error) => {
  logger.error('Failed to schedule memory cleanup', { error: serializeError(error) });
});

// === GRACEFUL SHUTDOWN ===
// Let in-flight jobs finish before exiting, so they aren't left half-processed
async function shutdown(signal: string) {
  logger.info({ event: 'worker:stopping', signal });
  await worker.close();
  await escalationWorker.close();
  await escalationQueue.close();
  await memoryCleanupWorker.close();
  await memoryCleanupQueue.close();
  await redisConnection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
