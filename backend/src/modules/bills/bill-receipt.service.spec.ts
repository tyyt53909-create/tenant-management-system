import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillReceiptService } from './bill-receipt.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('BillReceiptService', () => {
  let service: BillReceiptService;
  let prisma: any;
  beforeEach(async () => {
    prisma = { bill: { findUnique: vi.fn(), findFirst: vi.fn() } };
    const module = await Test.createTestingModule({ providers: [BillReceiptService, { provide: PrismaService, useValue: prisma }] }).compile();
    service = module.get(BillReceiptService);
  });
  const bill = (overrides: any = {}) => ({ id: 'b1', billNumber: 'BILL-1', amount: 1000, paidAmount: 300, period: '2026-01', billType: 'RENT', status: 'PARTIAL', dueDate: new Date(), paymentRecords: [], lateFees: [], contract: { tenantId: 't1', tenant: { id: 't1', name: 'N', phone: 'P' }, room: { id: 'r1', roomNumber: '101', building: { name: 'Building' } } }, ...overrides });

  it('returns receipt with fallbacks and payment totals', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill({ contract: null, paymentRecords: [{ id: 'p1', amount: 100, paymentMethod: 'CASH', paidAt: new Date(), transactionNumber: null, notes: null }], lateFees: [{ confirmedAmount: 200, settledAmount: 0 }] }));
    const result = await service.getReceipt('b1');
    expect(result.payerName).toBe('租客');
    expect(result.roomNumber).toBe('');
    expect(result.confirmedLateFee).toBe(200);
    expect(result.totalPaid).toBe(100);
  });

  it('rejects absent bills and unauthorized tenants', async () => {
    prisma.bill.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(bill()).mockResolvedValueOnce(bill({ contract: null }));
    await expect(service.getReceipt('b1')).rejects.toThrow(NotFoundException);
    await expect(service.getReceipt('b1', 'other')).rejects.toThrow(NotFoundException);
    await expect(service.getReceipt('b1', 't1')).rejects.toThrow(NotFoundException);
  });

  it('租客无档案（tenantId 为空串）→ 404，不再 fail-open 返回他人收据（T209）', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill());

    await expect(service.getReceipt('b1', '')).rejects.toThrow(NotFoundException);
  });

  it('recognizes voucher tags, bill references and direct ids with amount statuses', async () => {
    prisma.bill.findFirst.mockResolvedValue(bill({ lateFees: [{ confirmedAmount: 100, settledAmount: 20 }], paymentRecords: [{ id: 'p', amount: 10, paidAt: new Date(), paymentMethod: 'CASH' }] }));
    expect((await service.recognizeVoucher('[VOUCHER:BILL-1:7]')).amountMatchStatus).toBe('MISMATCH');
    expect((await service.recognizeVoucher('单号：BILL-1 ¥9')).matchedBy).toBe('BILL-1');
    expect((await service.recognizeVoucher('BILL-1')).amountMatchStatus).toBe('UNKNOWN');
    expect((await service.recognizeVoucher('账单编号：BILL-1 金额：9.8')).extractedAmountCents).toBe(980);
  });

  it('validates inputs and handles missing bills', async () => {
    for (const input of ['', '  ', 'nonsense']) await expect(service.recognizeVoucher(input)).rejects.toThrow(BadRequestException);
    prisma.bill.findFirst.mockResolvedValue(null);
    await expect(service.recognizeVoucher('BILL-1')).rejects.toThrow(NotFoundException);
  });

  it('returns recognized data with absent optional relations and matched amount', async () => {
    prisma.bill.findFirst.mockResolvedValue(bill({ contract: null, amount: 1000, paidAmount: 0 }));
    const result = await service.recognizeVoucher('VOUCHER:BILL-1:1000');
    expect(result.amountMatchStatus).toBe('MATCHED');
    expect(result.tenant.name).toBe('租客');
    expect(result.room.roomNumber).toBe('—');
  });

  it('handles omitted fee/payment arrays and unknown bill types', async () => {
    prisma.bill.findUnique.mockResolvedValue(bill({ billType: 'CUSTOM', paymentRecords: null, lateFees: null }));
    const result = await service.getReceipt('b1');
    expect(result.billTypeLabel).toBe('CUSTOM');
    expect(result.totalPaid).toBe(0);
    expect(result.confirmedLateFee).toBe(0);
  });

  it('recognizes a voucher without embedded amount', async () => {
    prisma.bill.findFirst.mockResolvedValue(bill());
    const result = await service.recognizeVoucher('VOUCHER:BILL-1');
    expect(result.extractedAmountCents).toBeNull();
    expect(result.amountMatchStatus).toBe('UNKNOWN');
  });
});
