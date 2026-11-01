import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { chatLimiter } from '../middleware/rateLimiter';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { askQuestion, listConversations, sendMessage } from '../controllers/chat.controller';
import { askQuestionSchema, sendMessageSchema } from '../validators/conversation.validator';
import { conditionalGet } from '../middleware/etag';


const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /chat/conversations:
 *   get:
 *     summary: List the current user's conversations
 *     description: Supports conditional requests via ETag / If-None-Match.
 *     tags: [Chat]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Paginated conversations
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
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *                         nullable: true
 *                       messageCount:
 *                         type: integer
 *                       lastMessage:
 *                         type: object
 *                         nullable: true
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       304:
 *         description: Not modified
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/conversations', conditionalGet(), listConversations);

/**
 * @swagger
 * /chat/{id}/messages:
 *   post:
 *     summary: Send a message in a conversation
 *     tags: [Chat]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 10000
 *               documentId:
 *                 type: string
 *                 description: Optional document to ground the reply in
 *     responses:
 *       201:
 *         description: Assistant message created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/RateLimited'
 */
router.post('/:id/messages',
  chatLimiter,              // Chat-specific limit
  requirePermission('conversations:create'),
  validate(sendMessageSchema),
  sendMessage
);

/**
 * @swagger
 * /chat/{id}/ask:
 *   post:
 *     summary: Ask a question about a document (RAG)
 *     description: >
 *       Answers are confidence-routed. High-confidence answers return 201.
 *       Low-confidence answers are sent to the human review queue and return 202
 *       with a status field.
 *     tags: [Chat]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question, documentId]
 *             properties:
 *               question:
 *                 type: string
 *                 maxLength: 10000
 *               documentId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Answer generated
 *       202:
 *         description: Answer queued for human review
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/RateLimited'
 */
router.post('/:id/ask',
  chatLimiter,
  requirePermission('conversations:create'),
  validate(askQuestionSchema),
  askQuestion
);

export { router as chatRoutes };
