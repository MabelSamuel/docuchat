import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { prisma } from '../lib/prisma';
import { appEvents } from '../lib/events';
import { NotFoundError, ValidationError } from '../lib/errors';
import {
  getCachedReviewMetrics,
  isMetricsPeriod,
  METRICS_PERIODS,
} from '../services/review-metrics.service';

const router = Router();
router.use(authenticate);
router.use(requirePermission('roles:manage'));

/**
 * @swagger
 * /admin/roles:
 *   get:
 *     summary: List roles with their permissions and user counts
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Roles
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
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                         nullable: true
 *                       isDefault:
 *                         type: boolean
 *                       userCount:
 *                         type: integer
 *                       permissions:
 *                         type: array
 *                         items:
 *                           type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
// List all roles with their permissions
router.get('/roles', async (req, res) => {
  const roles = await prisma.role.findMany({
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { users: true } },
    },
  });

  res.json({
    success: true,
    data: roles.map(role => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isDefault: role.isDefault,
      userCount: role._count.users,
      permissions: role.permissions.map(rp => rp.permission.name),
    })),
  });
});

/**
 * @swagger
 * /admin/users/{userId}/roles:
 *   post:
 *     summary: Assign a role to a user
 *     tags: [Admin]
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleName]
 *             properties:
 *               roleName:
 *                 type: string
 *                 example: reviewer
 *     responses:
 *       200:
 *         description: Role assigned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: User or role not found
 */
// Assign a role to a user
router.post('/users/:userId/roles', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { roleName } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) throw new NotFoundError(`Role '${roleName}' not found`);

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: {
        userId,
        roleId: role.id,
        assignedBy: req.user!.id,
      },
    });

    // Audit event
    appEvents.emit('admin:role-assigned', {
      targetUserId: userId,
      roleName,
      assignedBy: req.user!.id,
    });

    res.json({
      success: true,
      data: { message: `Role '${roleName}' assigned to user` },
    });
  } catch (error) { next(error); }
});

/**
 * @swagger
 * /admin/users/{userId}/roles/{roleName}:
 *   delete:
 *     summary: Revoke a role from a user
 *     tags: [Admin]
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: roleName
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role revoked
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Role not found
 */
// Revoke a role from a user
router.delete('/users/:userId/roles/:roleName',
  async (req, res, next) => {
    try {
      const { userId, roleName } = req.params;

      const role = await prisma.role.findUnique({
        where: { name: roleName },
      });
      if (!role) throw new NotFoundError('Role not found');

      await prisma.userRole.deleteMany({
        where: { userId, roleId: role.id },
      });

      appEvents.emit('admin:role-revoked', {
        targetUserId: userId,
        roleName,
        revokedBy: req.user!.id,
      });

      res.json({
        success: true,
        data: { message: `Role '${roleName}' revoked` },
      });
    } catch (error) { next(error); }
  }
);

/**
 * @swagger
 * /admin/analytics:
 *   get:
 *     summary: Review-queue analytics (cached for 5 minutes)
 *     tags: [Admin]
 *     parameters:
 *       - name: period
 *         in: query
 *         schema:
 *           type: string
 *           enum: ['1h', '24h', '7d', '30d']
 *           default: '24h'
 *     responses:
 *       200:
 *         description: Analytics
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
 *                     review:
 *                       type: object
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
// Admin analytics dashboard (cached for 5 minutes)
router.get('/analytics', async (req, res, next) => {
  try {
    const period = req.query.period ?? '24h';
    if (!isMetricsPeriod(period)) {
      throw new ValidationError(
        `Invalid period. Use one of: ${METRICS_PERIODS.join(', ')}`
      );
    }

    const review = await getCachedReviewMetrics(period);

    res.json({
      success: true,
      data: { review },
    });
  } catch (error) { next(error); }
});

export default router;
