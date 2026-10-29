import { Queue } from 'bullmq';
import { redisConnection } from './connection';

export const escalationQueue = new Queue('escalation-checker', {
  connection: redisConnection,
});

// Idempotent: upserting the same scheduler id on every boot never creates
// duplicate repeat jobs, even with several worker processes
export async function scheduleEscalationChecks() {
  await escalationQueue.upsertJobScheduler(
    'check-escalations',
    { every: 5 * 60 * 1000 }, // Every 5 minutes
    { name: 'check-escalations', data: {} },
  );
}
