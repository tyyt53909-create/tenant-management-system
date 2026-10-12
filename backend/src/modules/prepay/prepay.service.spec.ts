import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
});
