import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createDocumentSchema,
  listDocumentsSchema,
  documentParamsSchema,
} from '../validators/document.validator';
import { requirePermission } from '../middleware/authorize';
import {
  listDocuments,
  createDocument,
  getDocument,
  deleteDocument,
} from '../controllers/document.controller';


const router = Router();
router.use(authenticate);

router.get('/',
  validate(listDocumentsSchema),
  requirePermission('documents:read'),
  listDocuments
);

router.post('/',
  validate(createDocumentSchema),
  requirePermission('documents:create'),
  createDocument
);

router.get('/:id',
  validate(documentParamsSchema),
  getDocument
);

router.delete('/:id',
  validate(documentParamsSchema),
  requirePermission('admin:documents:delete', 'documents:delete'),
  deleteDocument
);



export { router as documentRoutes };
