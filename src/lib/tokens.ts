import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

// These should never be the same value.
// If they were, a refresh token could be used as an access token.

interface TokenPayload {
  sub: string;    // User ID
  role: string;   // User role/tier
  type: 'access' | 'refresh';
}

export function generateAccessToken(user: { id: string; tier: string }) {
  return jwt.sign(
    { sub: user.id, role: user.tier, type: 'access' },
    ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

export function generateRefreshToken(user: { id: string; tier: string }) {
  return jwt.sign(
    { sub: user.id, role: user.tier, type: 'refresh' },
    REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as TokenPayload;
}
