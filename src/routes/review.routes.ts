import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { reviewQueueService } from '../services/review-queue.service';
import {
  listReviewsSchema,
  reviewParamsSchema,
  reviewDecisionSchema,
} from '../validators/review.validator';

const router = Router();
router.use(authenticate);
router.use(requirePermission('reviews:manage'));

// List the review queue (URGENT first, oldest first within priority)
router.get('/', validate(listReviewsSchema), async (req, res) => {
  const { status, page, limit } = req.query as any;
  const result = await reviewQueueService.list({ status, page, limit });
  res.json({ success: true, ...result });
});

// Claim the next pending item for the current reviewer
router.post('/claim', async (req, res) => {
  const review = await reviewQueueService.claimNext(req.user!.id);
  if (!review) {
    return res.status(204).end();
  }
  res.json({ success: true, data: review });
});

router.get('/:id', validate(reviewParamsSchema), async (req, res) => {
  const review = await reviewQueueService.getById(req.params.id as string);
  res.json({ success: true, data: review });
});

// Approve (optionally with an edited answer) or reject a claimed item
router.post('/:id/decision', validate(reviewDecisionSchema), async (req, res) => {
  const review = await reviewQueueService.processDecision(
    req.params.id as string,
    req.user!.id,
    req.body
  );
  res.json({ success: true, data: review });
});

export { router as reviewRoutes };
