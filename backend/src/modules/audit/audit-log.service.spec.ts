import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogService } from './audit-log.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('AuditLogService（T323 - R09）', () => {
  let service: AuditLogService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: PrismaService,
          useValue: {
            auditLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('log 应写入脱敏后的审计记录', async () => {
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'a-1' } as any);
    const result = await service.log({
      userId: 'u-1',
      action: 'POST /api/rooms',
      entityType: 'rooms',
      entityId: '-',
      changes: { name: 'Room 101', token: 'secret-token' },
      ip: '127.0.0.1',
      userAgent: 'test',
    });
    expect(result?.id).toBe('a-1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: { name: 'Room 101', token: '[REDACTED]' },
      }),
    });
  });

  it('recordEvent 在事务 client (tx) 内记录前后值并递归脱敏', async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'admin-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-event-1' }),
      },
    };

    const res = await service.recordEvent({
      tx: tx as never,
      action: 'BILL_PAYMENT',
      entityType: 'Bill',
      entityId: 'bill-1',
      actorId: 'admin-1',
      before: { paidAmount: 0, status: 'PENDING' },
      after: { paidAmount: 50000, status: 'PAID', password: 'should-be-masked' },
      reason: '租客现金缴费',
      context: { paymentMethod: 'CASH' },
    });

    expect(res.id).toBe('audit-event-1');
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        action: 'BILL_PAYMENT',
        entityType: 'Bill',
        entityId: 'bill-1',
        changes: {
          before: { paidAmount: 0, status: 'PENDING' },
          after: { paidAmount: 50000, status: 'PAID', password: '[REDACTED]' },
          reason: '租客现金缴费',
          actor: 'admin-1',
          context: { paymentMethod: 'CASH' },
        },
        ip: '127.0.0.1',
        userAgent: 'system',
      },
    });
  });

  it('系统操作或匿名事件的 userId 记为 null，不伪造操作者', async () => {
    const tx = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-sys' }),
      },
    };

    await service.recordEvent({
      tx: tx as never,
      action: 'AUTO_BILLING',
      entityType: 'Bill',
      entityId: 'bill-auto',
      actorId: 'SYSTEM',
      before: null,
      after: { amount: 3000 },
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: null,
        changes: expect.objectContaining({ actor: 'SYSTEM' }),
      }),
    });
  });

  it('事务内审计写入失败时抛出错误，阻止业务假成功', async () => {
    const tx = {
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error('audit db error')),
      },
    };

    await expect(
      service.recordEvent({
        tx: tx as never,
        action: 'PAYMENT_REVERSAL',
        entityType: 'Bill',
        entityId: 'bill-rev',
        actorId: 'admin-1',
      }),
    ).rejects.toThrow('audit db error');
  });

  it('findAll 应支持 entity 过滤与分页', async () => {
    vi.spyOn(prisma.auditLog, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.auditLog, 'count').mockResolvedValue(0);
    const result = await service.findAll({ page: 1, limit: 20, entityType: 'rooms' });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityType: 'rooms' }) }),
    );
    expect(result.meta.total).toBe(0);
  });
});
