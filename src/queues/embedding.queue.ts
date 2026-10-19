import { Queue } from 'bullmq';
import { redisConnection } from './connection';

export const embeddingQueue = new Queue('embedding-generation', {
  connection: redisConnection,
});
