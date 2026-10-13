import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BillsService } from './bills.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('BillsService', () => {
  let service: BillsService;
  let prisma: any;

  const billId = 'bill-001';
  const operatorId = 'admin-001';

  beforeEach(async () => {
    const prismaMock: any = {
      bill: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      contract: { findUnique: vi.fn() },
      paymentRecord: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      lateFee: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [BillsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<BillsService>(BillsService);
    prisma = prismaMock;
    // 默认无滞纳金（收款用例回归不受影响）
    prisma.lateFee.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addPayment', () => {
    it('部分收款：写入收款记录，状态 PENDING → PARTIAL', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'PENDING',
      });
      prisma.paymentRecord.findFirst.mockResolvedValue(null);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-1', amount: 40000 });
      prisma.bill.update.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 40000,
        status: 'PARTIAL',
      });

      const result = await service.addPayment(
        billId,
        { amount: 40000, paymentMethod: 'CASH' } as any,
        operatorId,
      );

      expect(prisma.paymentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId,
          amount: 40000,
          confirmedBy: operatorId,
        }),
      });
      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: billId },
        data: { paidAmount: 40000, status: 'PARTIAL' },
      });
      expect(result.bill.status).toBe('PARTIAL');
    });

    it('补缴剩余：状态 PARTIAL → PAID', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 40000,
        status: 'PARTIAL',
      });
      prisma.paymentRecord.findFirst.mockResolvedValue(null);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-2', amount: 60000 });
      prisma.bill.update.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 100000,
        status: 'PAID',
      });

      const result = await service.addPayment(
        billId,
        { amount: 60000, paymentMethod: 'BANK_TRANSFER' } as any,
        operatorId,
      );

      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: billId },
        data: { paidAmount: 100000, status: 'PAID' },
      });
      expect(result.bill.status).toBe('PAID');
    });

    it('逾期账单部分收款：OVERDUE → PARTIAL（docs/04-状态机.md）', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'OVERDUE',
      });
      prisma.paymentRecord.findFirst.mockResolvedValue(null);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-3', amount: 30000 });
      prisma.bill.update.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 30000,
        status: 'PARTIAL',
      });

      const result = await service.addPayment(
        billId,
        { amount: 30000, paymentMethod: 'WECHAT' } as any,
        operatorId,
      );

      expect(result.bill.status).toBe('PARTIAL');
    });

    it('账单不存在 → NotFoundException，不写记录', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(
        service.addPayment(billId, { amount: 10000, paymentMethod: 'CASH' } as any, operatorId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('已缴清（PAID）不可收款 → BadRequestException', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 100000,
        status: 'PAID',
      });

      await expect(
        service.addPayment(billId, { amount: 10000, paymentMethod: 'CASH' } as any, operatorId),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('已取消（CANCELLED）不可收款 → BadRequestException', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'CANCELLED',
      });

      await expect(
        service.addPayment(billId, { amount: 10000, paymentMethod: 'CASH' } as any, operatorId),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('收款金额超过未缴金额 → BadRequestException，不写记录', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 40000,
        status: 'PARTIAL',
      });

      await expect(
        service.addPayment(billId, { amount: 70000, paymentMethod: 'CASH' } as any, operatorId),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('收款金额恰好等于未缴金额 → PAID（边界）', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 40000,
        status: 'PARTIAL',
      });
      prisma.paymentRecord.findFirst.mockResolvedValue(null);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-4', amount: 60000 });
      prisma.bill.update.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 100000,
        status: 'PAID',
      });

      const result = await service.addPayment(
        billId,
        { amount: 60000, paymentMethod: 'CASH' } as any,
        operatorId,
      );

      expect(result.bill.status).toBe('PAID');
    });

    it('交易号重复 → ConflictException（幂等）', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 40000,
        status: 'PARTIAL',
      });
      prisma.paymentRecord.findFirst.mockResolvedValue({ id: 'pay-existing' });

      await expect(
        service.addPayment(
          billId,
          { amount: 10000, paymentMethod: 'BANK_TRANSFER', transactionNumber: 'TXN-001' } as any,
          operatorId,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('未提供交易号（现金）时不查重，直接写入', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'PENDING',
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-5', amount: 10000 });
      prisma.bill.update.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 10000,
        status: 'PARTIAL',
      });

      await service.addPayment(billId, { amount: 10000, paymentMethod: 'CASH' } as any, operatorId);

      expect(prisma.paymentRecord.findFirst).not.toHaveBeenCalled();
      expect(prisma.paymentRecord.create).toHaveBeenCalled();
    });

    it('收款上限含未核销滞纳金：超出 → 400', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'OVERDUE',
      });
      prisma.lateFee.findMany.mockResolvedValue([
        { id: 'lf-1', confirmedAmount: 4200, settledAmount: null },
      ]);

      await expect(
        service.addPayment(billId, { amount: 104300, paymentMethod: 'CASH' } as any, operatorId),
      ).rejects.toThrow('收款金额不能超过未缴金额');
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('全额收款（含滞纳金）：账单 PAID + 滞纳金结清', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'OVERDUE',
      });
      prisma.lateFee.findMany.mockResolvedValue([
        { id: 'lf-1', confirmedAmount: 4200, settledAmount: null },
      ]);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-6', amount: 104200 });
      prisma.lateFee.update.mockResolvedValue({ id: 'lf-1', settledAmount: 4200 });
      prisma.bill.update.mockResolvedValue({ id: billId, paidAmount: 100000, status: 'PAID' });

      const result = await service.addPayment(
        billId,
        { amount: 104200, paymentMethod: 'WECHAT' } as any,
        operatorId,
      );

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'lf-1' },
        data: expect.objectContaining({
          settledAmount: 4200,
          settledBy: operatorId,
          settledAt: expect.any(Date),
        }),
      });
      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: billId },
        data: { paidAmount: 100000, status: 'PAID' },
      });
      expect(result.bill.status).toBe('PAID');
    });

    it('账单已满但滞纳金未清：PARTIAL，滞纳金不动', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'OVERDUE',
      });
      prisma.lateFee.findMany.mockResolvedValue([
        { id: 'lf-1', confirmedAmount: 4200, settledAmount: null },
      ]);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-7' });
      prisma.bill.update.mockResolvedValue({ id: billId, paidAmount: 100000, status: 'PARTIAL' });

      const result = await service.addPayment(
        billId,
        { amount: 100000, paymentMethod: 'CASH' } as any,
        operatorId,
      );

      expect(prisma.lateFee.update).not.toHaveBeenCalled();
      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: billId },
        data: { paidAmount: 100000, status: 'PARTIAL' },
      });
      expect(result.bill.status).toBe('PARTIAL');
    });

    it('两笔滞纳金按确认先后核销（本金优先，部分核销不写结清）', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'OVERDUE',
      });
      prisma.lateFee.findMany.mockResolvedValue([
        { id: 'lf-1', confirmedAmount: 4200, settledAmount: null },
        { id: 'lf-2', confirmedAmount: 3000, settledAmount: null },
      ]);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-8' });
      prisma.lateFee.update.mockImplementation(async (args: any) => args.data);
      prisma.bill.update.mockResolvedValue({ id: billId, paidAmount: 100000, status: 'PARTIAL' });

      await service.addPayment(billId, { amount: 103000, paymentMethod: 'CASH' } as any, operatorId);

      // 103000 = 本金 100000 + 核销 lf-1 的 3000（部分）
      expect(prisma.lateFee.update).toHaveBeenCalledTimes(1);
      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'lf-1' },
        data: { settledAmount: 3000 },
      });
    });

    it('部分核销累计：补缴后结清 → PAID', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 100000,
        status: 'PARTIAL',
      });
      prisma.lateFee.findMany.mockResolvedValue([
        { id: 'lf-1', confirmedAmount: 4200, settledAmount: 3000 },
      ]);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-9' });
      prisma.lateFee.update.mockResolvedValue({ id: 'lf-1', settledAmount: 4200 });
      prisma.bill.update.mockResolvedValue({ id: billId, paidAmount: 100000, status: 'PAID' });

      await service.addPayment(billId, { amount: 1200, paymentMethod: 'CASH' } as any, operatorId);

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'lf-1' },
        data: expect.objectContaining({
          settledAmount: 4200,
          settledBy: operatorId,
          settledAt: expect.any(Date),
        }),
      });
      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: billId },
        data: { paidAmount: 100000, status: 'PAID' },
      });
    });
  });

  describe('findPayments', () => {
    it('账单不存在 → NotFoundException', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(service.findPayments(billId)).rejects.toThrow(NotFoundException);
    });

    it('返回该账单的收款流水（按收款时间倒序）', async () => {
      prisma.bill.findUnique.mockResolvedValue({ id: billId });
      const records = [
        { id: 'pay-2', amount: 60000 },
        { id: 'pay-1', amount: 40000 },
      ];
      prisma.paymentRecord.findMany.mockResolvedValue(records);

      const result = await service.findPayments(billId);

      expect(result).toEqual(records);
      expect(prisma.paymentRecord.findMany).toHaveBeenCalledWith({
        where: { billId },
        orderBy: { paidAt: 'desc' },
      });
    });
  });

  describe('addLateFee', () => {
    const rule = { graceDays: 3, dailyRate: 0.003, cap: 50000 };
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

    const overdueBill = (overrides: any = {}) => ({
      id: billId,
      amount: 200000,
      paidAmount: 0,
      status: 'OVERDUE',
      dueDate: daysAgo(10),
      contract: { lateFeeRule: rule },
      ...overrides,
    });

    it('账单不存在 → NotFoundException', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(service.addLateFee(billId, {}, operatorId)).rejects.toThrow(NotFoundException);
      expect(prisma.lateFee.create).not.toHaveBeenCalled();
    });

    it('PAID / CANCELLED 状态不可添加滞纳金 → BadRequestException', async () => {
      for (const status of ['PAID', 'CANCELLED']) {
        prisma.bill.findUnique.mockResolvedValue(overdueBill({ status }));

        await expect(service.addLateFee(billId, {}, operatorId)).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(prisma.lateFee.create).not.toHaveBeenCalled();
    });

    it('未逾期（到期日当天不算）→ BadRequestException', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill({ dueDate: new Date() }));

      await expect(service.addLateFee(billId, {}, operatorId)).rejects.toThrow(
        '账单尚未逾期，无需计算滞纳金',
      );
      expect(prisma.lateFee.create).not.toHaveBeenCalled();
    });

    it('未缴金额为 0（已缴清）→ BadRequestException', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill({ paidAmount: 200000 }));

      await expect(service.addLateFee(billId, {}, operatorId)).rejects.toThrow(
        '账单已缴清，无需计算滞纳金',
      );
    });

    it('生成建议值：按合同规则计算并写入计算过程', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill());
      prisma.lateFee.findFirst.mockResolvedValue(null);
      prisma.lateFee.create.mockResolvedValue({ id: 'lf-1', suggestedAmount: 4200 });

      await service.addLateFee(billId, {}, operatorId);

      // 逾期10天 − 宽限3天 = 7 天 × 200000 × 0.003 = 4200
      expect(prisma.lateFee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId,
          suggestedAmount: 4200,
          overdueDays: 10,
          calculation: expect.objectContaining({
            effectiveDays: 7,
            baseAmount: 200000,
            capped: false,
          }),
        }),
      });
      expect(prisma.lateFee.update).not.toHaveBeenCalled();
    });

    it('重复生成建议：刷新未确认建议，不重复建单', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill());
      prisma.lateFee.findFirst.mockResolvedValue({ id: 'lf-1', confirmedAmount: null });
      prisma.lateFee.update.mockResolvedValue({ id: 'lf-1', suggestedAmount: 4200 });

      await service.addLateFee(billId, {}, operatorId);

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'lf-1' },
        data: expect.objectContaining({ suggestedAmount: 4200, overdueDays: 10 }),
      });
      expect(prisma.lateFee.create).not.toHaveBeenCalled();
    });

    it('确认入账：写入确认金额、确认人与备注（可调整金额）', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill());
      prisma.lateFee.findFirst.mockResolvedValue({ id: 'lf-1', confirmedAmount: null });
      prisma.lateFee.update.mockResolvedValue({ id: 'lf-1', confirmedAmount: 3800 });

      await service.addLateFee(billId, { confirmedAmount: 3800, notes: '协商减免' }, operatorId);

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'lf-1' },
        data: expect.objectContaining({
          confirmedAmount: 3800,
          confirmedBy: operatorId,
          confirmedAt: expect.any(Date),
          notes: '协商减免',
        }),
      });
    });

    it('无建议直接确认：建单即确认', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill());
      prisma.lateFee.findFirst.mockResolvedValue(null);
      prisma.lateFee.create.mockResolvedValue({ id: 'lf-2', confirmedAmount: 4200 });

      await service.addLateFee(billId, { confirmedAmount: 4200 }, operatorId);

      expect(prisma.lateFee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          billId,
          suggestedAmount: 4200,
          confirmedAmount: 4200,
          confirmedBy: operatorId,
        }),
      });
    });

    it('确认金额 0（减免）：直接标记结清，不产生应收', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill());
      prisma.lateFee.findFirst.mockResolvedValue({ id: 'lf-1', confirmedAmount: null });
      prisma.lateFee.update.mockResolvedValue({ id: 'lf-1', confirmedAmount: 0 });

      await service.addLateFee(billId, { confirmedAmount: 0 }, operatorId);

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'lf-1' },
        data: expect.objectContaining({
          confirmedAmount: 0,
          settledAmount: 0,
          settledAt: expect.any(Date),
          settledBy: operatorId,
        }),
      });
    });

    it('重复确认 → ConflictException，不写记录', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill());
      prisma.lateFee.findFirst
        .mockResolvedValueOnce(null) // 未确认建议不存在
        .mockResolvedValueOnce({ id: 'lf-done', confirmedAmount: 4200 }); // 已有确认记录

      await expect(
        service.addLateFee(billId, { confirmedAmount: 4200 }, operatorId),
      ).rejects.toThrow(ConflictException);
      expect(prisma.lateFee.create).not.toHaveBeenCalled();
    });

    it('已确认后再生成建议 → ConflictException', async () => {
      prisma.bill.findUnique.mockResolvedValue(overdueBill());
      prisma.lateFee.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'lf-done', confirmedAmount: 4200 });

      await expect(service.addLateFee(billId, {}, operatorId)).rejects.toThrow(ConflictException);
    });
  });

  describe('findLateFees', () => {
    it('账单不存在 → NotFoundException', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(service.findLateFees(billId)).rejects.toThrow(NotFoundException);
    });

    it('返回滞纳金记录（含计算过程，按创建时间倒序）', async () => {
      prisma.bill.findUnique.mockResolvedValue({ id: billId });
      const records = [{ id: 'lf-1', suggestedAmount: 4200 }];
      prisma.lateFee.findMany.mockResolvedValue(records);

      const result = await service.findLateFees(billId);

      expect(result).toEqual(records);
      expect(prisma.lateFee.findMany).toHaveBeenCalledWith({
        where: { billId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
