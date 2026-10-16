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
      paymentRecord: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
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

  it('finds payment history and rejects unknown bills', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(bill());
    await expect(service.findPayments('b1')).rejects.toThrow(NotFoundException);
    prisma.paymentRecord.findMany.mockResolvedValue([]);
    expect(await service.findPayments('b1')).toEqual([]);
  });
});
