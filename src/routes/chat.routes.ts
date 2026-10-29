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

router.get('/conversations', conditionalGet(), listConversations);

router.post('/:id/messages',
  chatLimiter,              // Chat-specific limit
  requirePermission('conversations:create'),
  validate(sendMessageSchema),
  sendMessage
);

router.post('/:id/ask',
  chatLimiter,
  requirePermission('conversations:create'),
  validate(askQuestionSchema),
  askQuestion
);

export { router as chatRoutes };
