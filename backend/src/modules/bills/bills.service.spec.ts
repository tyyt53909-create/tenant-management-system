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
        findFirst: vi.fn(),
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

    it('并发防护：收款时对当前账单执行悲观行锁 FOR UPDATE', async () => {
      prisma.$queryRaw = vi.fn().mockResolvedValue([{ id: billId }]);
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 0,
        status: 'PENDING',
      });
      prisma.paymentRecord.findFirst.mockResolvedValue(null);
      prisma.paymentRecord.create.mockResolvedValue({ id: 'pay-lock', amount: 40000 });
      prisma.bill.update.mockResolvedValue({
        id: billId,
        amount: 100000,
        paidAmount: 40000,
        status: 'PARTIAL',
      });

      await service.addPayment(
        billId,
        { amount: 40000, paymentMethod: 'CASH' } as any,
        operatorId,
      );

      expect(prisma.$queryRaw).toHaveBeenCalledWith(
        expect.objectContaining({ strings: expect.arrayContaining([expect.stringContaining('FOR UPDATE')]) }),
      );
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

  describe('账单 CRUD（T148 核心业务覆盖率补齐）', () => {
    it('create：合同不存在 → 400', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ contractId: 'c-x', billType: 'RENT', period: '2026-11', amount: 100, dueDate: '2026-11-05' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.bill.create).not.toHaveBeenCalled();
    });

    it('create：成功 → 生成账单编号与应缴日期', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'contract-1' });
      prisma.bill.create.mockResolvedValue({ id: billId });

      await service.create({
        contractId: 'contract-1',
        billType: 'RENT',
        period: '2026-11',
        amount: 100000,
        dueDate: '2026-11-05',
      } as any);

      expect(prisma.bill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contractId: 'contract-1',
          billNumber: expect.stringMatching(/^B\d+[A-Z0-9]+$/),
          amount: 100000,
          dueDate: expect.any(Date),
          snapshot: {},
        }),
      });
    });

    it('findAll：status/billType/contractId 过滤 + 分页', async () => {
      prisma.bill.findMany.mockResolvedValue([]);
      prisma.bill.count.mockResolvedValue(0);

      const result = await service.findAll({
        page: 2,
        limit: 10,
        status: 'PENDING',
        billType: 'RENT',
        contractId: 'contract-1',
      } as any);

      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING', billType: 'RENT', contractId: 'contract-1' },
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({ page: 2, limit: 10, total: 0, totalPages: 0 });
    });

    it('findOne：不存在 → 404', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(service.findOne(billId)).rejects.toThrow(NotFoundException);
    });

    it('update：仅更新传入字段', async () => {
      prisma.bill.findUnique.mockResolvedValue({ id: billId });
      prisma.bill.update.mockResolvedValue({ id: billId, status: 'CANCELLED' });

      await service.update(billId, { status: 'CANCELLED', dueDate: '2026-12-05' } as any);

      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: billId },
        data: { status: 'CANCELLED', dueDate: expect.any(Date) },
      });
    });

    it('update：不存在 → 404', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(service.update(billId, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('remove：删除账单', async () => {
      prisma.bill.findUnique.mockResolvedValue({ id: billId });
      prisma.bill.delete.mockResolvedValue({ id: billId });

      await expect(service.remove(billId)).resolves.toEqual({ message: '账单已删除' });
    });

    it('remove：不存在 → 404', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(service.remove(billId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('租客数据隔离（T148）', () => {
    it('findByTenant：服务端固定按 contract.tenantId 过滤', async () => {
      prisma.bill.findMany.mockResolvedValue([]);
      prisma.bill.count.mockResolvedValue(0);

      await service.findByTenant('tenant-1', { page: 1, limit: 20, status: 'PENDING' } as any);

      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contract: { tenantId: 'tenant-1' }, status: 'PENDING' },
        }),
      );
    });

    it('findOneForTenant：自己的账单 → 返回，且滞纳金仅含已确认金额', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        contract: { tenantId: 'tenant-1' },
      });

      const result = await service.findOneForTenant(billId, 'tenant-1');

      expect(result.id).toBe(billId);
      const args = prisma.bill.findUnique.mock.calls[0][0];
      expect(args.include.lateFees.where).toEqual({ confirmedAmount: { not: null } });
    });

    it('findOneForTenant：他人账单 → 404（不暴露存在性）', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: billId,
        contract: { tenantId: 'tenant-2' },
      });

      await expect(service.findOneForTenant(billId, 'tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('findOneForTenant：账单不存在 → 404', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);

      await expect(service.findOneForTenant(billId, 'tenant-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('exportBills', () => {
    it('正确生成包含 UTF-8 BOM 的账单 CSV', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'b-1',
          billNumber: 'B20261001-001',
          billType: 'RENT',
          period: '2026-10',
          amount: 250000,
          paidAmount: 250000,
          status: 'PAID',
          dueDate: new Date('2026-10-05'),
          createdAt: new Date('2026-10-01'),
          contract: {
            tenant: { name: '李四', phone: '13900000002' },
            room: { roomNumber: '302' },
          },
          lateFees: [],
        },
      ]);

      const csv = await service.exportBills({ status: 'PAID' });

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('账单编号,房间号,租客姓名,租客手机,账单类型,账期,应付金额(元),已付金额(元),未付本金(元),确认滞纳金(元),到期日期,状态,创建时间');
      expect(csv).toContain('B20261001-001,302,李四,13900000002,租金,2026-10,2500.00,2500.00,0.00,0.00,2026-10-05,已支付');
    });
  });

  describe('getReceipt', () => {
    it('账单不存在：404', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);
      await expect(service.getReceipt('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('返回完整单据快照，包括中文大写金额和收款流水', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'b-1',
        billNumber: 'B20261001-001',
        billType: 'RENT',
        period: '2026-10',
        amount: 300000,
        paidAmount: 300000,
        status: 'PAID',
        contract: {
          tenant: { name: '王五', phone: '13700000003' },
          room: { roomNumber: '501', building: { name: '阳光公寓' } },
        },
        paymentRecords: [
          {
            id: 'pay-1',
            amount: 300000,
            paymentMethod: 'WECHAT',
            transactionNumber: 'WX123456',
            paidAt: new Date('2026-10-02'),
            notes: '微信转账',
          },
        ],
        lateFees: [],
      });

      const receipt = await service.getReceipt('b-1');

      expect(receipt.receiptNumber).toBe('RCP-B20261001-001');
      expect(receipt.payerName).toBe('王五');
      expect(receipt.roomNumber).toBe('501');
      expect(receipt.buildingName).toBe('阳光公寓');
      expect(receipt.principalAmount).toBe(300000);
      expect(receipt.totalPaid).toBe(300000);
      expect(receipt.unpaid).toBe(0);
      expect(receipt.amountInChinese).toBe('叁仟元整');
      expect(receipt.payments).toHaveLength(1);
      expect(receipt.payments[0].amountYuan).toBe('3000.00');
    });

    it('租客越权读取他人收据抛出 NotFoundException', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'b-1',
        contract: { tenantId: 'tenant-real' },
      });

      await expect(service.getReceipt('b-1', 'tenant-attacker')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('租客读取自己收据正常放行', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'b-1',
        billNumber: 'B20261001-001',
        amount: 300000,
        paidAmount: 300000,
        dueDate: new Date('2026-10-15'),
        period: '2026-10',
        contract: {
          tenantId: 'tenant-real',
          tenant: { name: '张三', phone: '13800000000' },
          room: { roomNumber: '101', building: { name: 'A栋' } },
        },
        paymentRecords: [],
        lateFees: [],
      });

      const res = await service.getReceipt('b-1', 'tenant-real');
      expect(res.receiptNumber).toBe('RCP-B20261001-001');
    });
  });

  describe('recognizeVoucher', () => {
    it('通过 [VOUCHER:单号:金额] 标签精准识别账单并比对金额', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-101',
        billNumber: 'BILL-202610-001',
        billType: 'RENT',
        period: '2026-10',
        status: 'PENDING',
        amount: 250000,
        paidAmount: 0,
        dueDate: new Date('2026-10-25'),
        contract: {
          tenant: { id: 't-1', name: '张三', phone: '13800000001' },
          room: { id: 'r-1', roomNumber: '302', building: { name: '2号楼' } },
        },
        paymentRecords: [],
        lateFees: [],
      });

      const input = '【栖居生活 · 缴费凭单】\n单据识别码：[VOUCHER:BILL-202610-001:250000]\n已转账请查收';
      const result = await service.recognizeVoucher(input);

      expect(result.success).toBe(true);
      expect(result.billNumber).toBe('BILL-202610-001');
      expect(result.room.roomNumber).toBe('302');
      expect(result.room.buildingName).toBe('2号楼');
      expect(result.tenant.name).toBe('张三');
      expect(result.unpaidAmount).toBe(250000);
      expect(result.amountMatchStatus).toBe('MATCHED');
      expect(result.isPaid).toBe(false);
    });

    it('部分缴纳后，单据金额等于原账单金额时不算匹配', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-103',
        billNumber: 'BILL-202610-001',
        billType: 'RENT',
        period: '2026-10',
        status: 'PARTIAL',
        amount: 250000,
        paidAmount: 50000,
        dueDate: new Date('2026-10-25'),
        contract: {
          tenant: { id: 't-1', name: '张三', phone: '13800000001' },
          room: { id: 'r-1', roomNumber: '302', building: { name: '2号楼' } },
        },
        paymentRecords: [],
        lateFees: [],
      });

      const result = await service.recognizeVoucher('[VOUCHER:BILL-202610-001:250000]');
      expect(result.amountMatchStatus).toBe('MISMATCH');
      expect(result.unpaidAmount).toBe(200000);
      expect(result.suggestedAmount).toBe(200000);
    });

    it('通过纯单号或文本中单号成功识别', async () => {
      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-102',
        billNumber: 'BILL-202610-002',
        billType: 'UTILITY',
        period: '2026-10',
        status: 'PAID',
        amount: 15000,
        paidAmount: 15000,
        dueDate: new Date('2026-10-20'),
        contract: {
          tenant: { id: 't-2', name: '李四', phone: '13900000002' },
          room: { id: 'r-2', roomNumber: '101', building: { name: '1号楼' } },
        },
        paymentRecords: [],
        lateFees: [],
      });

      const result = await service.recognizeVoucher('账单编号：BILL-202610-002');
      expect(result.success).toBe(true);
      expect(result.billNumber).toBe('BILL-202610-002');
      expect(result.isPaid).toBe(true);
      expect(result.unpaidAmount).toBe(0);
    });

    it('未找到账单或无法提取单号时正确抛出异常', async () => {
      await expect(service.recognizeVoucher('')).rejects.toThrow(BadRequestException);
      await expect(service.recognizeVoucher('这是一段完全无关的文字没有任何数字')).rejects.toThrow(BadRequestException);

      prisma.bill.findFirst.mockResolvedValue(null);
      await expect(service.recognizeVoucher('BILL-NOT-EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  describe('T196-Ws1 分支覆盖补充', () => {
    it('findOne：找到账单时返回查询结果', async () => {
      const bill = { id: billId, status: 'PENDING', lateFees: [] };
      prisma.bill.findUnique.mockResolvedValue(bill);

      await expect(service.findOne(billId)).resolves.toBe(bill);
    });

    it('update：更新金额、已付金额及所有可选字段', async () => {
      prisma.bill.findUnique.mockResolvedValue({ id: billId });
      prisma.bill.update.mockResolvedValue({ id: billId });

      await service.update(billId, {
        amount: 12000,
        paidAmount: 3000,
        status: 'PARTIAL',
        dueDate: '2026-12-15',
      } as any);

      expect(prisma.bill.update).toHaveBeenCalledWith({
        where: { id: billId },
        data: {
          amount: 12000,
          paidAmount: 3000,
          status: 'PARTIAL',
          dueDate: new Date('2026-12-15'),
        },
      });
    });

    it('findByTenant：未传筛选时按租客过滤，缺失租客直接返回空页', async () => {
      prisma.bill.findMany.mockResolvedValue([]);
      prisma.bill.count.mockResolvedValue(0);

      const result = await service.findByTenant('tenant-1', {} as any);
      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { contract: { tenantId: 'tenant-1' } } }),
      );
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });

      await expect(service.findByTenant('', {} as any)).resolves.toEqual({
        data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('findByTenant：同时传入状态和账单类型筛选', async () => {
      prisma.bill.findMany.mockResolvedValue([]);
      prisma.bill.count.mockResolvedValue(0);

      await service.findByTenant('tenant-1', { status: 'PENDING', billType: 'UTILITY' } as any);

      expect(prisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contract: { tenantId: 'tenant-1' }, status: 'PENDING', billType: 'UTILITY' },
        }),
      );
    });

    it('exportBills：应用所有筛选日期，并覆盖 CSV 可空关联与未知标签', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'b-export', billNumber: 'B-EXPORT', billType: 'CUSTOM', period: '2026-10',
          amount: 10000, paidAmount: 2000, status: 'CUSTOM_STATUS', dueDate: null, createdAt: null,
          contract: null, lateFees: null,
        },
      ]);

      const csv = await service.exportBills({
        status: 'PENDING', billType: 'RENT', contractId: 'contract-1', buildingId: 'building-1',
        startDate: '2026-10-01', endDate: '2026-10-31',
      });

      expect(prisma.bill.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          status: 'PENDING', billType: 'RENT', contractId: 'contract-1',
          contract: { room: { buildingId: 'building-1' } },
          dueDate: { gte: new Date('2026-10-01'), lte: new Date('2026-10-31') },
        },
      }));
      expect(csv).toContain('B-EXPORT,,,,CUSTOM,2026-10,100.00,20.00,80.00,0.00,,CUSTOM_STATUS');
    });

    it('exportBills：仅结束日期时省略起始日期，已确认滞纳金正常导出', async () => {
      prisma.bill.findMany.mockResolvedValue([
        {
          id: 'b-confirmed', billNumber: 'B-CONFIRMED', billType: 'RENT', period: '2026-10',
          amount: 10000, paidAmount: 10000, status: 'PAID', dueDate: new Date('2026-10-10'),
          createdAt: new Date('2026-10-01'),
          contract: { tenant: { name: '租客', phone: '123' }, room: { roomNumber: 'A1' } },
          lateFees: [{ suggestedAmount: 100, confirmedAmount: 200, settledAmount: 50,
            overdueDays: 1, confirmedAt: new Date(), settledAt: null }],
        },
      ]);

      const csv = await service.exportBills({ endDate: '2026-10-31' });

      expect(prisma.bill.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { dueDate: { lte: new Date('2026-10-31') } },
      }));
      expect(csv).toContain('B-CONFIRMED,A1,租客,123,租金,2026-10,100.00,100.00,0.00,2.00,2026-10-10,已支付');
    });
  });
});
