import './lib/config'; // Load and validate env vars first
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redisConnection } from './queues/connection';

// The worker emits 'doc:processed', so its listeners must live in this process too
import './events/document.events';

import { worker } from './queues/document.worker';

logger.info({ event: 'worker:started', queue: worker.name });

// === GRACEFUL SHUTDOWN ===
// Let in-flight jobs finish before exiting, so they aren't left half-processed
async function shutdown(signal: string) {
  logger.info({ event: 'worker:stopping', signal });
  await worker.close();
  await redisConnection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
