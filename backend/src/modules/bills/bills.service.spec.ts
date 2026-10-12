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
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [BillsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<BillsService>(BillsService);
    prisma = prismaMock;
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
});
