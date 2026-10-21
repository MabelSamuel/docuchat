import { appEvents } from '../lib/events';
import { cacheRedis } from '../lib/cache';
import { logger, serializeError } from '../lib/logger';

appEvents.on('auth:login-failed', async (data) => {
  try {
    const key = `login-failures:${data.deviceInfo}`;
    const failures = await cacheRedis.incr(key);

    // Set expiry on first failure
    if (failures === 1) {
      await cacheRedis.expire(key, 900);  // 15 minute window
    }

    if (failures >= 5) {
      logger.warn('Repeated failed logins', {
        failures,
        deviceInfo: data.deviceInfo,
        email: data.email,
      });
      // Could add the IP to a temporary block list here
    }
  } catch (error) {
    logger.error('Failed to track login failure', {
      deviceInfo: data.deviceInfo,
      error: serializeError(error),
    });
  }
});
