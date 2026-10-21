import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';
import { logger, serializeError } from '../lib/logger';

// ── Define the event names as constants ─────────────
export const AUTH_EVENTS = {
  USER_REGISTERED: 'auth:user-registered',
  USER_LOGGED_IN: 'auth:user-logged-in',
  USER_LOGGED_OUT: 'auth:user-logged-out',
  TOKEN_REFRESHED: 'auth:token-refreshed',
  LOGIN_FAILED: 'auth:login-failed',
} as const;


// ── Register listeners ─────────────────────────────

// Listener 1: Log signups for analytics
appEvents.on(AUTH_EVENTS.USER_REGISTERED, async (user) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        action: 'signup',
        tokens: 0,
        costUsd: 0,
        metadata: JSON.stringify({
          email: user.email,
          tier: user.tier,
          registeredAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    // Log but don't crash. This is a side effect.
    logger.error('Failed to log signup', {
      userId: user.id,
      error: serializeError(error),
    });
  }
});

// Listener 2: Create a default welcome conversation
appEvents.on(AUTH_EVENTS.USER_REGISTERED, async (user) => {
  try {
    await prisma.conversation.create({
      data: {
        userId: user.id,
        title: 'Welcome to DocuChat',
      },
    });
  } catch (error) {
    logger.error('Failed to create welcome conversation', {
      userId: user.id,
      error: serializeError(error),
    });
  }
});

// Listener 3: Log login events (useful for security audits)
appEvents.on(AUTH_EVENTS.USER_LOGGED_IN, async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.userId,
        action: 'login',
        tokens: 0,
        costUsd: 0,
        metadata: JSON.stringify({
          deviceInfo: data.deviceInfo,
          loginAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to log login', {
      userId: data.userId,
      error: serializeError(error),
    });
  }
});

// Listener 4: Track failed login attempts
appEvents.on(AUTH_EVENTS.LOGIN_FAILED, async (data) => {
  try {
    logger.warn('Failed login attempt', {
      email: data.email,
      deviceInfo: data.deviceInfo,
    });
    // In Week 3 we'll add rate limiting based on failed attempts
  } catch (error) {
    logger.error('Failed to log failed login', {
      email: data.email,
      error: serializeError(error),
    });
  }
});
