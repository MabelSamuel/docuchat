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
import { uploadLimiter } from '../middleware/rateLimiter';


const router = Router();
router.use(authenticate);

/**
 * @swagger
 * /documents:
 *   get:
 *     summary: List the current user's documents
 *     tags: [Documents]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [pending, processing, ready, failed]
 *       - name: search
 *         in: query
 *         schema:
 *           type: string
 *           maxLength: 200
 *       - name: sortBy
 *         in: query
 *         schema:
 *           type: string
 *           enum: [createdAt, title, chunkCount]
 *           default: createdAt
 *       - name: sortOrder
 *         in: query
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Paginated documents
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
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *   post:
 *     summary: Create a document and queue it for processing
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, content]
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 500
 *               content:
 *                 type: string
 *     responses:
 *       202:
 *         description: Document accepted; chunking and embedding run in the background
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/RateLimited'
 */
router.get('/',
  validate(listDocumentsSchema),
  requirePermission('documents:read'),
  listDocuments
);

router.post('/',
  uploadLimiter,
  validate(createDocumentSchema),
  requirePermission('documents:create'),
  createDocument
);

/**
 * @swagger
 * /documents/{id}:
 *   get:
 *     summary: Get a document
 *     description: Supports conditional requests via ETag / If-None-Match.
 *     tags: [Documents]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: The document
 *       304:
 *         description: Not modified
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Delete a document
 *     description: Requires documents:delete (own documents) or admin:documents:delete.
 *     tags: [Documents]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       204:
 *         description: Deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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

/**
 * @swagger
 * /documents/{id}/processing-status:
 *   get:
 *     summary: Get a document's processing status and job progress
 *     tags: [Documents]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: Processing status
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
 *                     status:
 *                       type: string
 *                       enum: [pending, processing, ready, failed]
 *                     error:
 *                       type: string
 *                       nullable: true
 *                     progress:
 *                       nullable: true
 *                       description: Progress of the active job, or null if none
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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
