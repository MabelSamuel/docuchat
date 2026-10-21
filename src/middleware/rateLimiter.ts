import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { cacheRedis } from '../lib/cache';
import { Request } from 'express';

// Helper to create limiters with Redis backing
function createLimiter(options: {
  windowMs: number;
  max: number | ((req: Request) => number);
  message: string;
  keyGenerator?: (req: Request) => string;
  prefix: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,   // Send X-RateLimit-* headers
    legacyHeaders: false,    // Don't send X-RateLimit-* (old format)
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        (cacheRedis as any).call(...args),
      prefix: options.prefix,
    }),
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: options.message,
      },
    },
    keyGenerator: options.keyGenerator ||
      ((req: Request) => (req as any).user?.id || ipKeyGenerator(req.ip || 'anonymous')),
  });
}

// Auth endpoints: same for everyone, keyed by IP (user isn't authenticated yet)
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  prefix: 'rl:auth:',
  message: 'Too many auth attempts. Please try again later.',
  keyGenerator: (req) => ipKeyGenerator(req.ip || 'anonymous'),
});

// General API: tier-based
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: (req: Request) => {
    const tier = (req as any).user?.tier || 'free';
    const limits: Record<string, number> = {
      free: 100,
      pro: 500,
      enterprise: 2000,
    };
    return limits[tier] || 100;
  },
  prefix: 'rl:api:',
  message: 'Rate limit exceeded. Please slow down.',
});

// Document uploads: tier-based, tight limits
export const uploadLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: (req: Request) => {
    const tier = (req as any).user?.tier || 'free';
    const limits: Record<string, number> = {
      free: 5,
      pro: 50,
      enterprise: 500,
    };
    return limits[tier] || 5;
  },
  prefix: 'rl:upload:',
  message: 'Upload limit reached. Please try again later.',
});

// AI/chat queries: tier-based, per-minute (expensive operations)
export const chatLimiter = createLimiter({
  windowMs: 60 * 1000,  // 1 minute
  max: (req: Request) => {
    const tier = (req as any).user?.tier || 'free';
    const limits: Record<string, number> = {
      free: 10,
      pro: 30,
      enterprise: 100,
    };
    return limits[tier] || 10;
  },
  prefix: 'rl:chat:',
  message: 'Too many queries. Please slow down.',
});

