import { Router } from 'express';
import * as authService from '../services/auth.service';

const router = Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: student@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: MyPassword123
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already registered
 */
router.post('/register', async (req, res, next) => {
  try {
    const user = await authService.register(req.body);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const result = await authService.login({
      ...req.body,
      deviceInfo: req.headers['user-agent'],
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const result = await authService.refresh(req.body.refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await authService.logout(req.body.refreshToken);
    res.json({ message: 'Logged out' });
  } catch (error) {
    next(error);
  }
});

export { router as authRoutes };
