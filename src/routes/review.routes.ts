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
/**
 * @swagger
 * /reviews:
 *   get:
 *     summary: List the review queue
 *     description: Ordered URGENT first, then oldest first within each priority.
 *     tags: [Reviews]
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [PENDING, IN_REVIEW, APPROVED, REJECTED, ESCALATED]
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Paginated review items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', validate(listReviewsSchema), async (req, res) => {
  const { status, page, limit } = req.query as any;
  const result = await reviewQueueService.list({ status, page, limit });
  res.json({ success: true, ...result });
});

// Claim the next pending item for the current reviewer
/**
 * @swagger
 * /reviews/claim:
 *   post:
 *     summary: Claim the next pending review item
 *     tags: [Reviews]
 *     responses:
 *       200:
 *         description: Claimed review item
 *       204:
 *         description: Queue is empty
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/claim', async (req, res) => {
  const review = await reviewQueueService.claimNext(req.user!.id);
  if (!review) {
    return res.status(204).end();
  }
  res.json({ success: true, data: review });
});

/**
 * @swagger
 * /reviews/{id}:
 *   get:
 *     summary: Get a review item
 *     tags: [Reviews]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Review item
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:id', validate(reviewParamsSchema), async (req, res) => {
  const review = await reviewQueueService.getById(req.params.id as string);
  res.json({ success: true, data: review });
});

// Approve (optionally with an edited answer) or reject a claimed item
/**
 * @swagger
 * /reviews/{id}/decision:
 *   post:
 *     summary: Approve or reject a claimed review item
 *     tags: [Reviews]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, reject]
 *               editedAnswer:
 *                 type: string
 *                 maxLength: 20000
 *                 description: Replacement answer to deliver on approve
 *               reviewerNotes:
 *                 type: string
 *                 maxLength: 5000
 *     responses:
 *       200:
 *         description: Updated review item
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post('/:id/decision', validate(reviewDecisionSchema), async (req, res) => {
  const review = await reviewQueueService.processDecision(
    req.params.id as string,
    req.user!.id,
    req.body
  );
  res.json({ success: true, data: review });
});

export { router as reviewRoutes };
