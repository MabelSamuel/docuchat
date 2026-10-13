import { appEvents } from '../lib/events';
import { prisma } from '../lib/prisma';

appEvents.on('admin:role-assigned', async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.assignedBy,
        action: 'role_assigned',
        tokens: 0,
        costUsd: 0,
        metadata: JSON.stringify({
          targetUserId: data.targetUserId,
          roleName: data.roleName,
          assignedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    console.error('Failed to log role assignment:', error);
  }
});

appEvents.on('admin:role-revoked', async (data) => {
  try {
    await prisma.usageLog.create({
      data: {
        userId: data.revokedBy,
        action: 'role_revoked',
        tokens: 0,
        costUsd: 0,
        metadata: JSON.stringify({
          targetUserId: data.targetUserId,
          roleName: data.roleName,
          revokedAt: new Date().toISOString(),
        }),
      },
    });
  } catch (error) {
    console.error('Failed to log role revocation:', error);
  }
});
