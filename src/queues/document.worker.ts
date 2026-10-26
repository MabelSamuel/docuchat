import { Worker, Job } from "bullmq";
import { redisConnection } from "./connection";
import { prisma } from "../lib/prisma";
import { appEvents } from "../lib/events";
import { chunkDocument } from "../lib/chunker";
import { deadLetterQueue } from "./dead-letter.queue";
import { logger, serializeError } from "../lib/logger";
import { detectFormat, extractText } from "../lib/documentExtractor";
import {
  generateEmbeddingsBatchCached,
  storeChunkEmbeddingsBatch,
} from "../services/embedding.service";
import { chunksPerDocument, ingestionDuration } from "../lib/metrics";

const worker = new Worker(
  "document-processing",
  async (job: Job) => {
    const { documentId, userId, correlationId } = job.data;
    const startTime = Date.now();

    logger.info("Document processing started", {
      correlationId,
      documentId,
      userId,
    });

    // Mark as processing
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "processing" },
    });

    try {
      // Step 1: Fetch the document content
      const doc = await prisma.document.findUniqueOrThrow({
        where: { id: documentId },
      });
      await job.updateProgress(5);

      // Step 2: Extract text
      // Documents created without a filename are raw text
      const format = doc.filename ? detectFormat(doc.filename) : "text";
      const { text, pageCount } = await extractText(doc.content, format);
      await job.updateProgress(15);

      logger.info("Text extracted", {
        correlationId,
        documentId,
        format,
        textLength: text.length,
        pageCount,
      });

      // Step 3: Chunk the text
      const chunks = chunkDocument(text, {
        maxTokens: 500,
        overlapTokens: 50,
        minChunkTokens: 50,
      });
      await job.updateProgress(30);

      logger.info("Document chunked", {
        correlationId,
        documentId,
        chunkCount: chunks.length,
        avgTokens: Math.round(
          chunks.reduce((sum, c) => sum + c.tokenEstimate, 0) / chunks.length,
        ),
      });

      // Step 4: Store chunks in database
      await prisma.$transaction(async (tx) => {
        // Delete any existing chunks (in case of retry)
        await tx.chunk.deleteMany({ where: { documentId } });

        await tx.chunk.createMany({
          data: chunks.map((chunk) => ({
            documentId,
            index: chunk.index,
            content: chunk.text,
            tokenCount: chunk.tokenEstimate,
          })),
        });
        await job.updateProgress(50);

        // Step 5: Generate embeddings (the expensive step)
        const chunkTexts = chunks.map((c) => c.text);
        const embeddings = await generateEmbeddingsBatchCached(chunkTexts, {
          userId,
          documentId,
        });
        await job.updateProgress(85);

        // Step 6: Store embeddings
        const storedChunks = await prisma.chunk.findMany({
          where: { documentId },
          orderBy: { index: "asc" },
          select: { id: true },
        });

        await storeChunkEmbeddingsBatch(
          storedChunks.map((c, i) => {
            const embedding = embeddings[i];
            if (!embedding) {
              throw new Error(`Missing embedding for chunk ${i}`);
            }
            return { id: c.id, embedding };
          }),
        );
        await job.updateProgress(95);

        // Step 7: Mark complete
        await tx.document.update({
          where: { id: documentId },
          data: { status: "ready", chunkCount: chunks.length },
        });
      });
      await job.updateProgress(100);

      const duration = Date.now() - startTime;

      ingestionDuration.observe({ format }, duration / 1000);
      chunksPerDocument.observe(chunks.length);

      // Emit completion event with metrics
      appEvents.emit("doc:processed", {
        documentId,
        userId,
        correlationId,
        chunkCount: chunks.length,
        durationMs: duration,
        format,
        pageCount,
      });

      logger.info("Document processing complete", {
        correlationId,
        documentId,
        chunkCount: chunks.length,
        durationMs: duration,
      });

      return { success: true, chunks: chunks.length, durationMs: duration };
    } catch (error) {
      // Only mark as failed on the LAST attempt
      if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: "failed",
            error: (error as Error).message,
          },
        });
      }
      logger.error("Document processing failed", {
        correlationId,
        documentId,
        error: (error as Error).message,
        attempt: job.attemptsMade + 1,
      });
      throw error; // Re-throw so BullMQ retries
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  },
);

// Event listeners for logging
worker.on("completed", (job) => {
  logger.info("Job completed", {
    jobId: job.id,
    documentId: job.data.documentId,
    userId: job.data.userId,
    chunks: job.returnvalue?.chunks,
  });
});

worker.on("failed", async (job, error) => {
  if (!job) return;

  // Check if all attempts exhausted
  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    logger.error("Job permanently failed, moving to DLQ", {
      jobId: job.id,
      documentId: job.data.documentId,
      userId: job.data.userId,
      attempts: job.attemptsMade,
      error: serializeError(error),
    });

    await deadLetterQueue.add("failed-document", {
      originalJobId: job.id,
      originalQueue: "document-processing",
      data: job.data,
      error: error.message,
      failedAt: new Date().toISOString(),
      attempts: job.attemptsMade,
    });
  }
});

worker.on("error", (error) => {
  logger.error("Worker error", {
    queue: "document-processing",
    error: serializeError(error),
  });
});

export { worker };
