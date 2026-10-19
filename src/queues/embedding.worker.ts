import { Worker } from 'bullmq';
import { openaiBreaker } from '../lib/http/openai.breaker';
import { redisConnection } from './connection';

const worker = new Worker(
  'embedding-generation',
  async (job) => {
    // Call OpenAI through the breaker
    return openaiBreaker.fire('/embeddings', {
      input: job.data.text,
      model: 'text-embedding-3-small',
    });
  },
  {
    connection: redisConnection,
    concurrency: 5,
    limiter: {
      max: 100,        // Max 100 jobs
      duration: 60000, // Per 60 seconds
    },
  }
);
