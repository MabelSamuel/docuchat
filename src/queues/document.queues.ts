import { Queue } from 'bullmq';
import { redisConnection } from './connection';

export const documentQueue = new Queue('document-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: { count: 200 }, // set to large number to remove all completed
    removeOnFail: { count: 500 }, // Set to 0 or delete config to not remove failed jobs.
  },
});

export async function queueDocumentForProcessing(
  documentId: string,
  userId: string
) {
  const job = await documentQueue.add(
    'process-document',
    { documentId, userId, queuedAt: Date.now() },
  );
  return job.id;
}
