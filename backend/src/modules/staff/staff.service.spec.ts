import { ConfigService } from '@nestjs/config';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service.js';

describe('StaffService lifecycle guards & multi-roles', () => {
  const prisma = {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    building: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    staffBuildingAssignment: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const jwt = { revokeUserSessions: vi.fn() };
  let service: StaffService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StaffService(prisma as never, new ConfigService({ BCRYPT_ROUNDS: '10' }), jwt as never);
    prisma.$transaction.mockImplementation((fn) =>
      fn({
        $queryRaw: vi.fn(),
        user: prisma.user,
        building: prisma.building,
        staffBuildingAssignment: prisma.staffBuildingAssignment,
      }),
    );
  });

  it('does not allow demoting or disabling the last active admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'a1', role: 'ADMIN', isActive: true });
    prisma.user.count.mockResolvedValue(1);
    await expect(service.update('a1', 'other', { isActive: false })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update('a1', 'other', { role: 'CLEANER' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not allow an admin to deactivate their own account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'a1', role: 'ADMIN', isActive: true });
    await expect(service.update('a1', 'a1', { isActive: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates staff with bcrypt and returns no password hash', async () => {
    prisma.user.create.mockResolvedValue({ id: 'staff-1', email: 'staff@example.com', role: 'PROPERTY_MANAGER', isActive: true, createdAt: new Date() });
    prisma.user.findUnique.mockResolvedValue({
      id: 'staff-1',
      email: 'staff@example.com',
      role: 'PROPERTY_MANAGER',
      isActive: true,
      createdAt: new Date(),
      buildingAssignments: [],
    });

    const created = await service.create({ email: 'Staff@Example.com', password: 'password123', role: 'PROPERTY_MANAGER' });
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe('staff@example.com');
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(created).not.toHaveProperty('passwordHash');
    expect(created.role).toBe('PROPERTY_MANAGER');
  });

  it('creates staff with building assignments and validates building existence', async () => {
    prisma.building.count.mockResolvedValue(2);
    prisma.user.create.mockResolvedValue({ id: 'pm-1', email: 'pm@example.com', role: 'PROPERTY_MANAGER', isActive: true });
    prisma.staffBuildingAssignment.createMany.mockResolvedValue({ count: 2 });
    prisma.user.findUnique.mockResolvedValue({
      id: 'pm-1',
      email: 'pm@example.com',
      role: 'PROPERTY_MANAGER',
      isActive: true,
      createdAt: new Date(),
      buildingAssignments: [
        { buildingId: 'b-1', building: { id: 'b-1', name: '1号楼' } },
        { buildingId: 'b-2', building: { id: 'b-2', name: '2号楼' } },
      ],
    });

    const created = await service.create({
      email: 'pm@example.com',
      password: 'password123',
      role: 'PROPERTY_MANAGER',
      buildingIds: ['b-1', 'b-2'],
    });

    expect(prisma.building.count).toHaveBeenCalledWith({ where: { id: { in: ['b-1', 'b-2'] } } });
    expect(prisma.staffBuildingAssignment.createMany).toHaveBeenCalled();
    expect(created.assignedBuildingIds).toEqual(['b-1', 'b-2']);
  });

  it('rejects staff creation if assigned building does not exist', async () => {
    prisma.building.count.mockResolvedValue(1); // 传入 2 个但仅 1 个存在
    await expect(
      service.create({
        email: 'pm@example.com',
        password: 'password123',
        role: 'PROPERTY_MANAGER',
        buildingIds: ['b-1', 'b-invalid'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects tenant role and never creates tenant users', async () => {
    await expect(service.create({ email: 'x@example.com', password: 'password123', role: 'TENANT' as never })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('resets staff password and revokes all sessions without returning it', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'cleaner-1', role: 'CLEANER' });
    prisma.user.update.mockResolvedValue({});
    const result = await service.resetPassword('cleaner-1', { newPassword: 'new-secure-password' });
    expect(prisma.user.update.mock.calls[0][0].data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(jwt.revokeUserSessions).toHaveBeenCalledWith('cleaner-1');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('assignBuildings replaces previous assignments', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'staff-1', role: 'MAINTAINER' });
    prisma.building.count.mockResolvedValue(1);
    prisma.staffBuildingAssignment.deleteMany.mockResolvedValue({ count: 1 });
    prisma.staffBuildingAssignment.createMany.mockResolvedValue({ count: 1 });
    prisma.staffBuildingAssignment.findMany.mockResolvedValue([
      { building: { id: 'b-1', name: '1号楼' } },
    ]);

    const result = await service.assignBuildings('staff-1', { buildingIds: ['b-1'] }, 'admin-1');
    expect(result).toEqual([{ id: 'b-1', name: '1号楼' }]);
    expect(prisma.staffBuildingAssignment.deleteMany).toHaveBeenCalledWith({ where: { userId: 'staff-1' } });
  });

  it('getMyBuildings: ADMIN returns all active buildings; non-ADMIN returns assigned buildings', async () => {
    prisma.building.findMany.mockResolvedValue([{ id: 'b-1', name: '1号楼' }, { id: 'b-2', name: '2号楼' }]);
    const adminBuildings = await service.getMyBuildings('admin-1', 'ADMIN');
    expect(adminBuildings).toHaveLength(2);

    prisma.staffBuildingAssignment.findMany.mockResolvedValue([
      { building: { id: 'b-1', name: '1号楼' } },
    ]);
    const staffBuildings = await service.getMyBuildings('staff-1', 'PROPERTY_MANAGER');
    expect(staffBuildings).toHaveLength(1);
    expect(staffBuildings[0].id).toBe('b-1');
  });

  it('findOne throws NotFoundException when staff does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findOne('none')).rejects.toThrow(NotFoundException);
  });
});
