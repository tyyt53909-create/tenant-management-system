import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { getStaffBuildingScope, assertStaffBuildingAccess } from './building-scope.util.js';

describe('building-scope.util', () => {
  it('ADMIN returns null for unrestricted access', async () => {
    const prisma: any = { staffBuildingAssignment: { findMany: vi.fn() } };
    const scope = await getStaffBuildingScope(prisma, { userId: 'admin-1', role: 'ADMIN' });
    expect(scope).toBeNull();
    expect(prisma.staffBuildingAssignment.findMany).not.toHaveBeenCalled();

    await expect(assertStaffBuildingAccess(prisma, { userId: 'admin-1', role: 'ADMIN' }, 'b-1')).resolves.toBeUndefined();
  });

  it('non-ADMIN returns assigned building IDs', async () => {
    const prisma: any = {
      staffBuildingAssignment: {
        findMany: vi.fn().mockResolvedValue([{ buildingId: 'b-1' }, { buildingId: 'b-2' }]),
      },
    };
    const scope = await getStaffBuildingScope(prisma, { userId: 'pm-1', role: 'PROPERTY_MANAGER' });
    expect(scope).toEqual(['b-1', 'b-2']);
  });

  it('assertStaffBuildingAccess passes for assigned building and throws for unassigned building', async () => {
    const prisma: any = {
      staffBuildingAssignment: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.buildingId === 'b-1') return Promise.resolve({ id: 'assign-1' });
          return Promise.resolve(null);
        }),
      },
    };

    await expect(assertStaffBuildingAccess(prisma, { userId: 'pm-1', role: 'PROPERTY_MANAGER' }, 'b-1')).resolves.toBeUndefined();
    await expect(assertStaffBuildingAccess(prisma, { userId: 'pm-1', role: 'PROPERTY_MANAGER' }, 'b-other')).rejects.toThrow(ForbiddenException);
  });
});
