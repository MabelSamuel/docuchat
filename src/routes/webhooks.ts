import { Router } from 'express';
import { verifyWebhookSignature } from '../middleware/verifyWebhook';
import { prisma } from '../lib/prisma';
import { documentQueue } from '../queues/document.queue';

const router = Router();

router.post(
  '/example',
  verifyWebhookSignature(process.env.EXAMPLE_WEBHOOK_SECRET!, 'X-Webhook-Signature'),
  async (req, res) => {
    // Body is still raw bytes here — parse it manually
    const event = JSON.parse((req as any).rawBody.toString());

    // Idempotency check
    const existing = await prisma.webhookEvent.findUnique({
      where: { id: event.id },
    });

    if (existing?.processedAt) {
      // Already processed. Acknowledge without re-processing.
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Record receipt (or update if half-processed)
    await prisma.webhookEvent.upsert({
      where: { id: event.id },
      update: {},
      create: {
        id: event.id,
        provider: 'example',
        eventType: event.type,
        payload: JSON.stringify(event),
      },
    });

    // ACKNOWLEDGE FAST. Process async.
    res.status(202).json({ received: true });

    // Queue the actual work
    try {
      await processWebhookEvent(event);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      console.error(`Webhook ${event.id} processing failed:`, error);
      // Don't mark processedAt. The provider will retry.
    }
  }
);

async function processWebhookEvent(event: any) {
  // Route to the right handler based on event type
  switch (event.type) {
    case 'document.imported':
      // Queue document processing
      break;
    default:
      console.log(`Unhandled webhook event type: ${event.type}`);
  }
}

export default router;
