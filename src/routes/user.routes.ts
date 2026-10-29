import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePermission } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { userRepository } from '../repositories/user.repository';
import { prisma } from '../lib/prisma';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import { userParamsSchema, updateUserSchema } from '../validators/user.validator';

const router = Router();
router.use(authenticate);

type UserRow = NonNullable<Awaited<ReturnType<typeof userRepository.findById>>>;

// Never send passwordHash over the wire
function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    tier: user.tier,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function findLiveUser(id: string) {
  const user = await userRepository.findById(id);
  if (!user || user.deletedAt) throw new NotFoundError('User not found');
  return user;
}

router.get('/me', async (req, res) => {
  const user = await findLiveUser(req.user!.id);
  res.json({ success: true, data: toPublicUser(user) });
});

router.get('/:id',
  validate(userParamsSchema),
  requirePermission('users:read'),
  async (req, res) => {
    const user = await findLiveUser(req.params.id as string);
    res.json({ success: true, data: toPublicUser(user) });
  }
);

router.patch('/:id',
  validate(updateUserSchema),
  requirePermission('users:manage'),
  async (req, res) => {
    const id = req.params.id as string;
    const { name, isActive } = req.body;

    if (id === req.user!.id && isActive === false) {
      throw new ForbiddenError('You cannot deactivate your own account');
    }
    await findLiveUser(id);

    const user = await userRepository.updateById(id, {
      ...(name !== undefined && { name }),
      ...(isActive !== undefined && { isActive }),
    });

    // Deactivated users must not be able to refresh their session
    if (isActive === false) {
      await prisma.refreshToken.deleteMany({ where: { userId: id } });
    }

    res.json({ success: true, data: toPublicUser(user) });
  }
);

router.delete('/:id',
  validate(userParamsSchema),
  requirePermission('users:manage'),
  async (req, res) => {
    const id = req.params.id as string;
    if (id === req.user!.id) {
      throw new ForbiddenError('You cannot delete your own account');
    }
    await findLiveUser(id);

    await userRepository.softDelete(id);
    // login/refresh check isActive, not deletedAt, so deactivate too
    await userRepository.updateById(id, { isActive: false });
    await prisma.refreshToken.deleteMany({ where: { userId: id } });

    res.json({ success: true, data: { message: 'User deleted' } });
  }
);

export { router as userRoutes };
