import { prisma } from "../lib/prisma";
import { cacheGetOrSet, CACHE_TTL } from "../lib/cache";

export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const permissions = await cacheGetOrSet<string[]>(
    `permissions:${userId}`,
    CACHE_TTL.PERMISSIONS,
    async () => {
      const userRoles = await prisma.userRole.findMany({
        where: { userId },
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      });

      const names = new Set<string>();
      for (const ur of userRoles) {
        for (const rp of ur.role.permissions) {
          names.add(rp.permission.name);
        }
      }

      return [...names]; // Array for JSON serialization
    }
  );

  return new Set(permissions);
}
