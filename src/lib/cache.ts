import IORedis from 'ioredis';
import crypto from 'crypto';

// TTL constants in seconds
export const CACHE_TTL = {
  PERMISSIONS: 300,       // 5 minutes
  DOCUMENT: 600,          // 10 minutes
  CONVERSATION_LIST: 120, // 2 minutes
  EMBEDDING: 604800,      // 7 days
  RAG_RESULT: 3600,       // 1 hour
} as const;

export const cacheRedis = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  keyPrefix: 'docuchat:',  // Namespace all keys
});


export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await cacheRedis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: any,
  ttlSeconds: number
): Promise<void> {
  await cacheRedis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await cacheRedis.del(key);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  // Use SCAN, never KEYS (KEYS blocks Redis on large datasets)
  const stream = cacheRedis.scanStream({ match: pattern, count: 100 });
  const pipeline = cacheRedis.pipeline();

  for await (const keys of stream) {
    for (const key of keys) {
      pipeline.del(key);
    }
  }

  await pipeline.exec();
}

export function hashKey(...parts: string[]): string {
  const data = parts.join(':');
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
} 

export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // 1. Try cache
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  // 2. Try to acquire lock
  const lockKey = `lock:${key}`;
  const acquired = await cacheRedis.set(
    lockKey, '1', 'EX', 5, 'NX'  // Expires in 5s, only if not exists
  );

  if (acquired) {
    // We got the lock. Fetch and cache.
    try {
      const value = await fetchFn();
      await cacheSet(key, value, ttlSeconds);
      return value;
    } finally {
      await cacheRedis.del(lockKey);
    }
  }

  // 3. Someone else has the lock. Wait briefly, then try cache again.
  await new Promise(resolve => setTimeout(resolve, 100));
  const retried = await cacheGet<T>(key);
  if (retried !== null) return retried;

  // 4. Lock holder failed or cache still empty. Just fetch directly.
  return fetchFn();
}


