import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/tokens';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
    }
  }
}

export function authenticate(
  req: Request, res: Response, next: NextFunction
) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1] as string;

  try {
    const payload = verifyAccessToken(token);

    // Make sure it's an access token, not a refresh token
    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    // Attach user context to the request
    req.user = { id: payload.sub, role: payload.role };
    next();

  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}
