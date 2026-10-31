import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

export async function cleanupMemories() {
  // 1. Delete expired memories
  const expired = await prisma.memory.deleteMany({
    where: {
      expiresAt: { not: null, lte: new Date() },
    },
  });

  // 2. Delete low-importance memories that have not been
  //    accessed in 60 days (they are not useful)
  const stale = await prisma.memory.deleteMany({
    where: {
      importance: { lt: 0.3 },
      lastAccessedAt: {
        lt: new Date(Date.now() - 60 * 86400000),
      },
    },
  });

  // 3. Enforce per-user memory limit (max 200 memories)
  //    Delete lowest-importance memories beyond the cap
  const users = await prisma.memory.groupBy({
    by: ['userId'],
    _count: true,
    having: { userId: { _count: { gt: 200 } } },
  });

  for (const user of users) {
    const excess = await prisma.memory.findMany({
      where: { userId: user.userId },
      orderBy: { importance: 'asc' },
      skip: 200,  // keep the top 200
      select: { id: true },
    });
    if (excess.length > 0) {
      await prisma.memory.deleteMany({
        where: { id: { in: excess.map(m => m.id) } },
      });
    }
  }

  logger.info({
    event: 'memory:cleanup',
    expiredDeleted: expired.count,
    staleDeleted: stale.count,
    usersCompacted: users.length,
  });
}
