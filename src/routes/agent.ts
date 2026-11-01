import { Router } from 'express';
import { requirePermission } from '../middleware/authorize';
import { chatLimiter } from '../middleware/rateLimiter';
import { runAgent } from '../agents/executor';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { researchSchema } from '../validators/agent.validator';

const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /agent/research:
 *   post:
 *     summary: Run the research agent over the user's documents
 *     tags: [Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question]
 *             properties:
 *               question:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Agent result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     answer:
 *                       type: string
 *                     sources:
 *                       type: array
 *                       items:
 *                         type: object
 *                     confidence:
 *                       type: number
 *                     metadata:
 *                       type: object
 *                       properties:
 *                         iterations:
 *                           type: integer
 *                         costUsd:
 *                           type: number
 *                         terminationReason:
 *                           type: string
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/RateLimited'
 */
router.post('/research',
  chatLimiter,
  requirePermission('conversations:create'),
  validate(researchSchema),
  async (req, res, next) => {
    try {
      const result = await runAgent({
        question: req.body.question,
        userId: req.user!.id,
        correlationId: (req as any).correlationId,
      });

      res.json({
        success: true,
        data: {
          answer: result.answer,
          sources: result.sources,
          confidence: result.confidence,
          metadata: {
            iterations: result.iterations,
            costUsd: result.totalCostUsd,
            terminationReason: result.terminationReason,
          },
        },
      });
    } catch (error) { next(error); }
  }
);

export default router;
