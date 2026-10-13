import { Worker, Job } from 'bullmq';
import { redisConnection } from './connection';
import { prisma } from '../lib/prisma';
import { appEvents } from '../lib/events';

const worker = new Worker(
  'document-processing',
  async (job: Job) => {
    const { documentId, userId } = job.data;
    console.log(`Processing document ${documentId} (attempt ${job.attemptsMade + 1})`);

    // Step 1: Fetch the document content
     const doc = await prisma.document.findUniqueOrThrow({
        where: { id: documentId },
      });

    // Mark as processing
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'processing' },
    });

    try {
      
       await job.updateProgress(10);

      // Step 2: Split into chunks
      const chunks = splitIntoChunks(doc.content, 500);
      await job.updateProgress(40);

      // Step 3: Store chunks in the database
      await prisma.$transaction(async (tx) => {

        // Delete any existing chunks (in case of retry)
        await tx.chunk.deleteMany({ where: { documentId } });

        await tx.chunk.createMany({
          data: chunks.map((text, index) => ({
            documentId,
            index,
            content: text,
            tokenCount: estimateTokens(text),
          })),
        });

        await tx.document.update({
          where: { id: documentId },
          data: { status: 'ready', chunkCount: chunks.length },
        });
      });
      await job.updateProgress(100);

      // Emit event for audit/notification
      appEvents.emit('doc:processed', {
        documentId,
        userId,
        chunkCount: chunks.length,
      });

      return { success: true, chunks: chunks.length };

    } catch (error) {
      // Only mark as failed on the LAST attempt
      if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {

        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: 'failed',
            error: (error as Error).message,
          },
        });

      }
      throw error; // Re-throw so BullMQ retries
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

// Event listeners for logging
worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed: ${job.returnvalue?.chunks} chunks`);
});

worker.on('failed', (job, error) => {
  console.error(`Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
    error.message);
});

worker.on('error', (error) => {
  console.error('Worker error:', error);
});

export { worker };
