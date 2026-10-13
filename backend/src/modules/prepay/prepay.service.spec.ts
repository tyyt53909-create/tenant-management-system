import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrepayService } from './prepay.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('PrepayService', () => {
  let service: PrepayService;
  let prisma: any;

  const accountId = 'account-001';
  const operatorId = 'admin-001';

  beforeEach(async () => {
    const prismaMock: any = {
      prepayAccount: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
      prepayTransaction: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
      tenant: { findUnique: vi.fn() },
      room: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrepayService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<PrepayService>(PrepayService);
    prisma = prismaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordTransaction', () => {
    it('充值：余额增加，流水金额为正', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 10000 });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId, balanceCache: 30000 });
      prisma.prepayTransaction.create.mockResolvedValue({
        id: 'tx-1',
        amount: 20000,
        balanceAfter: 30000,
      });

      const result = await service.recordTransaction(
        accountId,
        { type: 'RECHARGE', amount: 20000, description: '充值 200 元' } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: { balanceCache: { increment: 20000 } },
      });
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'RECHARGE',
          amount: 20000,
          balanceAfter: 30000,
          operatorId,
        }),
      });
      expect(result.transaction.balanceAfter).toBe(30000);
    });

    it('扣费：条件更新（余额充足），流水金额为负', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 30000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({
        id: accountId,
        balanceCache: 10000,
      });
      prisma.prepayTransaction.create.mockResolvedValue({
        id: 'tx-2',
        amount: -20000,
        balanceAfter: 10000,
      });

      const result = await service.recordTransaction(
        accountId,
        { type: 'DEDUCTION', amount: 20000, description: '电费扣款' } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: accountId, balanceCache: { gte: 20000 } },
        data: { balanceCache: { decrement: 20000 } },
      });
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ amount: -20000, balanceAfter: 10000 }),
      });
      expect(result.transaction.amount).toBe(-20000);
    });

    it('扣费余额不足：条件更新 count=0 → 400，不写流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 5000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordTransaction(
          accountId,
          { type: 'DEDUCTION', amount: 20000, description: '扣款' } as any,
          operatorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayTransaction.create).not.toHaveBeenCalled();
    });

    it('退款：同为出账（-amount），余额不足被拒绝', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 5000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordTransaction(
          accountId,
          { type: 'REFUND', amount: 8000, description: '余额退还' } as any,
          operatorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: accountId, balanceCache: { gte: 8000 } },
        data: { balanceCache: { decrement: 8000 } },
      });
    });

    it('调整（负数）：不做余额校验，直接扣减', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, balanceCache: 10000 });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId, balanceCache: 4000 });
      prisma.prepayTransaction.create.mockResolvedValue({
        id: 'tx-3',
        amount: -6000,
        balanceAfter: 4000,
      });

      const result = await service.recordTransaction(
        accountId,
        { type: 'ADJUSTMENT', amount: -6000, description: '修正多收' } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: { balanceCache: { decrement: 6000 } },
      });
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'ADJUSTMENT', amount: -6000 }),
      });
      expect(result.transaction.amount).toBe(-6000);
    });

    it('调整金额为 0：400', async () => {
      await expect(
        service.recordTransaction(
          accountId,
          { type: 'ADJUSTMENT', amount: 0, description: '无效' } as any,
          operatorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayAccount.findUnique).not.toHaveBeenCalled();
    });

    it('充值金额为负：400（方向由类型决定）', async () => {
      await expect(
        service.recordTransaction(
          accountId,
          { type: 'RECHARGE', amount: -100, description: '无效' } as any,
          operatorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayAccount.findUnique).not.toHaveBeenCalled();
    });

    it('账户不存在：404，不写流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.recordTransaction(
          accountId,
          { type: 'RECHARGE', amount: 10000, description: '充值' } as any,
          operatorId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.prepayTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('findAccountTransactions', () => {
    it('账户不存在：404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.findAccountTransactions(accountId, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('分页倒序返回流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });
      const records = [{ id: 'tx-2' }, { id: 'tx-1' }];
      prisma.prepayTransaction.findMany.mockResolvedValue(records);
      prisma.prepayTransaction.count.mockResolvedValue(2);

      const result = await service.findAccountTransactions(accountId, { page: 1, limit: 20 });

      expect(result.data).toEqual(records);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith({
        where: { accountId },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('账户管理（T148 核心业务覆盖率补齐）', () => {
    it('create：租客不存在 → 400', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ tenantId: 'tenant-x', roomId: 'room-1' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.prepayAccount.create).not.toHaveBeenCalled();
    });

    it('create：同一租客同一房间已有账户 → 409', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });

      await expect(
        service.create({ tenantId: 'tenant-1', roomId: 'room-1' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('create：成功 → 未指定时低余额阈值为 10000 分', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue(null);
      prisma.prepayAccount.create.mockResolvedValue({ id: accountId });

      await service.create({ tenantId: 'tenant-1', roomId: 'room-1' } as any);

      expect(prisma.prepayAccount.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', roomId: 'room-1', lowBalanceThreshold: 10000 },
      });
    });

    it('findAll：tenantId 过滤 + 分页 + 补充房间号', async () => {
      prisma.prepayAccount.findMany.mockResolvedValue([
        { id: accountId, roomId: 'room-1' },
        { id: 'account-2', roomId: 'room-2' },
      ]);
      prisma.prepayAccount.count.mockResolvedValue(2);
      prisma.room.findMany.mockResolvedValue([{ id: 'room-1', roomNumber: '101' }]);

      const result = await service.findAll({ page: 1, limit: 20, tenantId: 'tenant-1' } as any);

      expect(prisma.prepayAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
      expect(prisma.room.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['room-1', 'room-2'] } },
        select: { id: true, roomNumber: true },
      });
      expect(result.data[0].roomNumber).toBe('101');
      expect(result.data[1].roomNumber).toBeNull();
      expect(result.meta.totalPages).toBe(1);
    });

    it('findOne：存在 → 返回最近 20 条流水', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId, transactions: [] });

      const result = await service.findOne(accountId);

      expect(result.id).toBe(accountId);
      expect(prisma.prepayAccount.findUnique).toHaveBeenCalledWith({
        where: { id: accountId },
        include: { tenant: true, transactions: { take: 20, orderBy: { createdAt: 'desc' } } },
      });
    });

    it('findOne：不存在 → 404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.findOne(accountId)).rejects.toThrow(NotFoundException);
    });

    it('update：修改低余额阈值', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });
      prisma.prepayAccount.update.mockResolvedValue({ id: accountId, lowBalanceThreshold: 5000 });

      const result = await service.update(accountId, { lowBalanceThreshold: 5000 } as any);

      expect(result.lowBalanceThreshold).toBe(5000);
      expect(prisma.prepayAccount.update).toHaveBeenCalledWith({
        where: { id: accountId },
        data: { lowBalanceThreshold: 5000 },
      });
    });

    it('update：不存在 → 404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.update(accountId, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('remove：删除账户', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: accountId });
      prisma.prepayAccount.delete.mockResolvedValue({ id: accountId });

      await expect(service.remove(accountId)).resolves.toEqual({ message: '预付账户已删除' });
    });

    it('remove：不存在 → 404', async () => {
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      await expect(service.remove(accountId)).rejects.toThrow(NotFoundException);
    });

    it('findByTenant：返回账户并补房间号', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue({ id: accountId, roomId: 'room-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1', roomNumber: '101' });

      const result = await service.findByTenant('tenant-1');

      expect(result.room?.roomNumber).toBe('101');
      expect(prisma.prepayAccount.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: { tenant: { select: { id: true, name: true } } },
      });
    });

    it('findByTenant：无账户 → 404', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue(null);

      await expect(service.findByTenant('tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('findTransactionsByTenant：无账户 → 空结果（不泄漏他人流水）', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue(null);

      const result = await service.findTransactionsByTenant('tenant-1', { page: 1, limit: 20 });

      expect(result.data).toEqual([]);
      expect(prisma.prepayTransaction.findMany).not.toHaveBeenCalled();
    });

    it('findTransactionsByTenant：有账户 → 仅查该账户流水', async () => {
      prisma.prepayAccount.findFirst.mockResolvedValue({ id: accountId });
      prisma.prepayTransaction.findMany.mockResolvedValue([{ id: 'tx-1' }]);
      prisma.prepayTransaction.count.mockResolvedValue(1);

      const result = await service.findTransactionsByTenant('tenant-1', { page: 1, limit: 20 });

      expect(result.meta.total).toBe(1);
      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { accountId } }),
      );
    });

    it('findAllTransactions：管理员分页（含租客名）', async () => {
      prisma.prepayTransaction.findMany.mockResolvedValue([{ id: 'tx-1' }]);
      prisma.prepayTransaction.count.mockResolvedValue(1);

      const result = await service.findAllTransactions({ page: 2, limit: 5 });

      expect(prisma.prepayTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
      expect(result.meta).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
    });
  });
});
