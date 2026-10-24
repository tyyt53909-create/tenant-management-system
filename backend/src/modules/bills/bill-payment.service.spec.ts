import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BillPaymentService } from './bill-payment.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('BillPaymentService', () => {
  let service: BillPaymentService;
  let prisma: any;
  const bill = (overrides: any = {}) => ({ id: 'b1', amount: 1000, paidAmount: 0, status: 'PENDING', ...overrides });

  beforeEach(async () => {
    prisma = {
      bill: { findUnique: vi.fn(), update: vi.fn() },
      lateFee: { findMany: vi.fn(), update: vi.fn() },
      paymentRecord: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    prisma.lateFee.findMany.mockResolvedValue([]);
    prisma.paymentRecord.create.mockResolvedValue({ id: 'p1' });
    prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));
    const module = await Test.createTestingModule({ providers: [BillPaymentService, { provide: PrismaService, useValue: prisma }] }).compile();
    service = module.get(BillPaymentService);
  });

  it('rejects absent and immutable bills', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(bill({ status: 'PAID' })).mockResolvedValueOnce(bill({ status: 'CANCELLED' }));
    for (let i = 0; i < 3; i++) await expect(service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op')).rejects.toThrow(i ? BadRequestException : NotFoundException);
  });

  it('rejects excess and duplicate transactions', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill());
    await expect(service.addPayment('b1', { amount: 1001, paymentMethod: 'CASH' } as any, 'op')).rejects.toThrow(BadRequestException);
    prisma.paymentRecord.findFirst.mockResolvedValue({ id: 'dup' });
    await expect(service.addPayment('b1', { amount: 100, paymentMethod: 'CASH', transactionNumber: 'x' } as any, 'op')).rejects.toThrow(ConflictException);
  });

  it('collects without a transaction number and records optional date', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill());
    const result = await service.addPayment('b1', { amount: 400, paymentMethod: 'CASH', paidAt: '2026-01-01' } as any, 'op');
    expect(prisma.paymentRecord.findFirst).not.toHaveBeenCalled();
    expect(result.bill.status).toBe('PARTIAL');
    expect(prisma.paymentRecord.create.mock.calls[0][0].data.paidAt).toEqual(new Date('2026-01-01'));
  });

  it('settles multiple fees, skipping zero balances, and reaches PAID', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill({ paidAmount: 900 }));
    prisma.lateFee.findMany.mockResolvedValue([
      { id: 'zero', confirmedAmount: 10, settledAmount: 10 },
      { id: 'fee', confirmedAmount: 200, settledAmount: 0 },
    ]);
    prisma.lateFee.update.mockImplementation(({ where, data }: any) => ({ id: where.id, ...data }));
    const result = await service.addPayment('b1', { amount: 300, paymentMethod: 'CASH' } as any, 'op');
    expect(prisma.lateFee.update).toHaveBeenCalledTimes(1);
    expect(result.bill.status).toBe('PAID');
  });

  describe('FIN-05 幂等 / 收据 / 作废冲正', () => {
    it('同一幂等键与金额重放返回原收款，不重复入账', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-existing',
        billId: 'b1',
        amount: 100,
        status: 'CONFIRMED',
      });

      const result = await service.addPayment(
        'b1',
        { amount: 100, paymentMethod: 'CASH', idempotencyKey: 'idem-1' } as any,
        'op',
      );

      expect(result.idempotent).toBe(true);
      expect(result.payment.id).toBe('p-existing');
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });

    it('同一幂等键用于不同金额 → 409', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-existing',
        billId: 'b1',
        amount: 50,
        status: 'CONFIRMED',
      });

      await expect(
        service.addPayment(
          'b1',
          { amount: 100, paymentMethod: 'CASH', idempotencyKey: 'idem-1' } as any,
          'op',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('收据号由数据库序列生成', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill());
      prisma.$queryRaw = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ nextval: 42n }]);

      await service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op');

      const created = prisma.paymentRecord.create.mock.calls[0][0].data;
      expect(created.receiptNumber).toMatch(/^R\d{8}000042$/);
      expect(created.billPortion).toBe(100);
      expect(created.status).toBe('CONFIRMED');
    });

    it('行锁失败不再被吞掉', async () => {
      prisma.$queryRaw = vi.fn().mockRejectedValue(new Error('lock timeout'));
      prisma.bill.findUnique.mockResolvedValue(bill());

      await expect(
        service.addPayment('b1', { amount: 100, paymentMethod: 'CASH' } as any, 'op'),
      ).rejects.toThrow('lock timeout');
    });

    it('作废收款生成负额冲正并把账单回退', async () => {
      prisma.bill.findUnique.mockResolvedValue(
        bill({ amount: 1000, paidAmount: 400, status: 'PARTIAL' }),
      );
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 400,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 400,
        lateFeePortion: 0,
        lateFeeAllocations: [],
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      const result = await service.voidPayment('b1', 'p1', 'op', '录错金额');

      expect(prisma.paymentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: -400,
          status: 'REVERSAL',
          reversalOfId: 'p1',
          billPortion: -400,
        }),
      });
      expect(prisma.paymentRecord.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'VOIDED', voidReason: '录错金额' }),
      });
      expect(result.bill.paidAmount).toBe(0);
      expect(result.bill.status).toBe('PENDING');
    });

    it('作废时按分配精确回滚滞纳金', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ paidAmount: 500 }));
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        amount: 300,
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        billPortion: 200,
        lateFeePortion: 100,
        lateFeeAllocations: [{ lateFeeId: 'f1', amount: 100 }],
      });
      prisma.lateFee.findUnique = vi.fn().mockResolvedValue({
        id: 'f1',
        confirmedAmount: 200,
        settledAmount: 100,
      });
      prisma.paymentRecord.create.mockResolvedValue({ id: 'rev1' });
      prisma.paymentRecord.update.mockResolvedValue({ id: 'p1', status: 'VOIDED' });
      prisma.bill.update.mockImplementation(({ data }: any) => ({ ...bill(), ...data }));

      await service.voidPayment('b1', 'p1', 'op', '冲正');

      expect(prisma.lateFee.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: { settledAmount: 0, settledAt: null, settledBy: null },
      });
    });

    it('重复作废幂等返回已有冲正', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ paidAmount: 0 }));
      prisma.paymentRecord.findUnique
        .mockResolvedValueOnce({ id: 'p1', billId: 'b1', status: 'VOIDED' })
        .mockResolvedValueOnce({ id: 'rev1', reversalOfId: 'p1' });

      const result = await service.voidPayment('b1', 'p1', 'op', 'again');

      expect(result.idempotent).toBe(true);
      expect(prisma.paymentRecord.create).not.toHaveBeenCalled();
    });
  });

  it('finds payment history and rejects unknown bills', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(bill());
    await expect(service.findPayments('b1')).rejects.toThrow(NotFoundException);
    prisma.paymentRecord.findMany.mockResolvedValue([]);
    expect(await service.findPayments('b1')).toEqual([]);
  });
});
