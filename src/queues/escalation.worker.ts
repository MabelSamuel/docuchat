import { Worker } from 'bullmq';
import { redisConnection } from './connection';
import { checkEscalations } from '../jobs/escalation-checker.job';
import { logger, serializeError } from '../lib/logger';

export const escalationWorker = new Worker(
  'escalation-checker',
  async () => {
    await checkEscalations();
  },
  {
    connection: redisConnection,
    concurrency: 1, // Overlapping runs would double-process the same items
  },
);

escalationWorker.on('failed', (job, error) => {
  logger.error('Escalation check failed', {
    jobId: job?.id,
    error: serializeError(error),
  });
});
