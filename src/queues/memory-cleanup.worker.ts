import { Worker } from 'bullmq';
import { redisConnection } from './connection';
import { cleanupMemories } from '../jobs/memory-cleanup.job';
import { logger, serializeError } from '../lib/logger';

export const memoryCleanupWorker = new Worker(
  'memory-cleanup',
  async () => {
    await cleanupMemories();
  },
  { connection: redisConnection, concurrency: 1 },
);

memoryCleanupWorker.on('failed', (job, error) => {
  logger.error('Memory cleanup failed', { jobId: job?.id, error: serializeError(error) });
});
