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

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get the current user
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: User
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PublicUser'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/me', async (req, res) => {
  const user = await findLiveUser(req.user!.id);
  res.json({ success: true, data: toPublicUser(user) });
});

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get a user (users:read)
 *     tags: [Users]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: User
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PublicUser'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   patch:
 *     summary: Update a user's name or active status (users:manage)
 *     description: Deactivating a user revokes their refresh tokens. You cannot deactivate yourself.
 *     tags: [Users]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 200
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PublicUser'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *   delete:
 *     summary: Soft-delete a user (users:manage)
 *     description: Also deactivates the user and revokes their refresh tokens. You cannot delete yourself.
 *     tags: [Users]
 *     parameters:
 *       - $ref: '#/components/parameters/IdParam'
 *     responses:
 *       200:
 *         description: User deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Message'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
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
