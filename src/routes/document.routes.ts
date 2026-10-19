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
import { prisma } from '../lib/prisma';
import { documentQueue } from '../queues/document.queue';
import { conditionalGet } from '../middleware/etag';


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
  conditionalGet(),
  getDocument
);

router.delete('/:id',
  validate(documentParamsSchema),
  requirePermission('admin:documents:delete', 'documents:delete'),
  deleteDocument
);

router.get('/:id/processing-status',
  authenticate,
  requirePermission('documents:read'),
  async (req, res) => {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, status: true, error: true, userId: true },
    });

    if (!doc || doc.userId !== req.user!.id) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Document not found' },
      });
    }

    // Try to find the active job for this document
    const jobs = await documentQueue.getJobs(['active', 'waiting']);
    const activeJob = jobs.find(
      j => j.data.documentId === req.params.id
    );

    res.json({
      success: true,
      data: {
        status: doc.status,
        error: doc.error,
        progress: activeJob ? await activeJob.progress : null,
      },
    });
  }
);

export { router as documentRoutes };
