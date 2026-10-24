import { ConfigService } from '@nestjs/config';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service.js';

describe('StaffService lifecycle guards', () => {
  const prisma = {
    user: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  const jwt = { revokeUserSessions: vi.fn() };
  let service: StaffService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new StaffService(prisma as never, new ConfigService({ BCRYPT_ROUNDS: '10' }), jwt as never);
    prisma.$transaction.mockImplementation((fn) => fn({ $queryRaw: vi.fn(), user: prisma.user }));
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
    prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ id: 'staff-1', email: data.email, phone: data.phone, role: data.role, isActive: true, createdAt: new Date() }));
    const created = await service.create({ email: 'Staff@Example.com', password: 'long-pass-123', role: 'CLEANER' });
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe('staff@example.com');
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(created).not.toHaveProperty('passwordHash');
  });

  it('rejects tenant role and never creates tenant users', async () => {
    await expect(service.create({ email: 'x@example.com', password: 'long-pass-123', role: 'TENANT' as never })).rejects.toBeInstanceOf(BadRequestException);
    // DTO type/validation excludes TENANT; only ADMIN and CLEANER are passed to this service.
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
});
