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
