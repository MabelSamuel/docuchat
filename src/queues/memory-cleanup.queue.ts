import { Queue } from 'bullmq';
import { redisConnection } from './connection';

export const memoryCleanupQueue = new Queue('memory-cleanup', {
  connection: redisConnection,
});

// Idempotent: same scheduler id on every boot never duplicates the repeat job
export async function scheduleMemoryCleanup() {
  await memoryCleanupQueue.upsertJobScheduler(
    'cleanup-memories',
    { pattern: '0 3 * * *' }, // Daily at 3 AM
    { name: 'cleanup-memories', data: {} },
  );
}
