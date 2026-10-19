import { Queue } from 'bullmq';
import { redisConnection } from './connection';

export const deadLetterQueue = new Queue('dead-letter', {
  connection: redisConnection,
});
