import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BillLateFeeService } from './bill-late-fee.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('BillLateFeeService', () => {
  let service: BillLateFeeService;
  let prisma: any;
  const lateBill = (overrides: any = {}) => ({ id: 'b1', status: 'OVERDUE', dueDate: new Date(Date.now() - 10 * 86400000), amount: 10000, paidAmount: 0, contract: { lateFeeRule: {} }, ...overrides });
  beforeEach(async () => {
    prisma = { bill: { findUnique: vi.fn() }, lateFee: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() }, $transaction: vi.fn() };
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    const module = await Test.createTestingModule({ providers: [BillLateFeeService, { provide: PrismaService, useValue: prisma }] }).compile();
    service = module.get(BillLateFeeService);
  });

  it('rejects absent, immutable, not-yet-overdue and fully paid bills', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(lateBill({ status: 'PAID' })).mockResolvedValueOnce(lateBill({ status: 'CANCELLED' })).mockResolvedValueOnce(lateBill({ dueDate: new Date(Date.now() + 86400000) })).mockResolvedValueOnce(lateBill({ paidAmount: 10000 }));
    await expect(service.addLateFee('b1', {}, 'op')).rejects.toThrow(NotFoundException);
    for (let i = 0; i < 3; i++) await expect(service.addLateFee('b1', {}, 'op')).rejects.toThrow(BadRequestException);
    // 已缴清走显式错误码 BILL_ALREADY_PAID（422），不再依赖消息兜底。
    await expect(service.addLateFee('b1', {}, 'op')).rejects.toThrow('账单已缴清，无需计算滞纳金');
  });

  it('creates and refreshes suggestions', async () => {
    prisma.bill.findUnique.mockResolvedValue(lateBill());
    prisma.lateFee.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'f1' });
    prisma.lateFee.create.mockResolvedValue({ id: 'new' });
    prisma.lateFee.update.mockResolvedValue({ id: 'f1' });
    expect(await service.addLateFee('b1', {}, 'op')).toEqual({ id: 'new' });
    expect(await service.addLateFee('b1', { notes: 'updated' }, 'op')).toEqual({ id: 'f1' });
  });

  it('supports a missing contract rule and both notes branches', async () => {
    prisma.bill.findUnique.mockResolvedValue(lateBill({ contract: null }));
    prisma.lateFee.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.lateFee.create.mockResolvedValue({ id: 'noted' });
    await service.addLateFee('b1', { notes: 'created with note' }, 'op');
    prisma.lateFee.findFirst.mockResolvedValueOnce({ id: 'pending' });
    prisma.lateFee.update.mockResolvedValue({ id: 'refreshed' });
    await service.addLateFee('b1', {}, 'op');
  });

  it('conflicts with already confirmed fee when no pending suggestion', async () => {
    prisma.bill.findUnique.mockResolvedValue(lateBill());
    prisma.lateFee.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'confirmed' });
    await expect(service.addLateFee('b1', {}, 'op')).rejects.toThrow(ConflictException);
    prisma.lateFee.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'confirmed' });
    await expect(service.addLateFee('b1', { confirmedAmount: 20 }, 'op')).rejects.toThrow(ConflictException);
  });

  it('confirms existing suggestion or creates confirmed fee, including zero waiver', async () => {
    prisma.bill.findUnique.mockResolvedValue(lateBill());
    prisma.lateFee.findFirst.mockResolvedValueOnce({ id: 'pending' });
    prisma.lateFee.update.mockResolvedValue({ id: 'pending' });
    await service.addLateFee('b1', { confirmedAmount: 0, notes: 'waived' }, 'op');
    expect(prisma.lateFee.update.mock.calls[0][0].data).toMatchObject({ settledAmount: 0, settledBy: 'op', notes: 'waived' });
    prisma.lateFee.findFirst.mockResolvedValueOnce(null);
    prisma.lateFee.create.mockResolvedValue({ id: 'created' });
    expect(await service.addLateFee('b1', { confirmedAmount: 100 }, 'op')).toEqual({ id: 'created' });
  });

  it('lists fees or rejects missing bill', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(lateBill());
    await expect(service.findLateFees('b1')).rejects.toThrow(NotFoundException);
    prisma.lateFee.findMany.mockResolvedValue([]);
    expect(await service.findLateFees('b1')).toEqual([]);
  });
});
