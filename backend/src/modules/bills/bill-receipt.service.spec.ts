import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillReceiptService } from './bill-receipt.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('BillReceiptService', () => {
  let service: BillReceiptService;
  let prisma: any;
  let configService: ConfigService;

  beforeEach(async () => {
    prisma = {
      bill: { findUnique: vi.fn(), findFirst: vi.fn() },
      paymentRecord: { findUnique: vi.fn(), findMany: vi.fn() },
    };
    configService = new ConfigService({
      JWT_SECRET: 'test-anti-counterfeit-secret-key-32',
    });

    const module = await Test.createTestingModule({
      providers: [
        BillReceiptService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(BillReceiptService);
  });

  const bill = (overrides: any = {}) => ({
    id: 'b1',
    billNumber: 'BILL-1',
    amount: 1000,
    paidAmount: 300,
    period: '2026-01',
    billType: 'RENT',
    status: 'PARTIAL',
    dueDate: new Date(),
    paymentRecords: [],
    lateFees: [],
    contract: {
      tenantId: 't1',
      tenant: { id: 't1', name: '张三丰', phone: '13812345678' },
      room: { id: 'r1', roomNumber: '101', building: { name: 'Building' } },
    },
    ...overrides,
  });

  describe('utility methods', () => {
    it('computeVerifyCode returns deterministic 16-char hex uppercase string for Date and string', () => {
      const code1 = service.computeVerifyCode('R20261025000001', 30000, new Date('2026-10-25T10:00:00.000Z'));
      const code2 = service.computeVerifyCode('R20261025000001', 30000, '2026-10-25T10:00:00.000Z');
      const codeDiff = service.computeVerifyCode('R20261025000002', 30000, '2026-10-25T10:00:00.000Z');

      expect(code1).toHaveLength(16);
      expect(code1).toBe(code2);
      expect(code1).not.toBe(codeDiff);
      expect(code1).toBe(code1.toUpperCase());
    });

    it('computeVerifyCode uses fallback secret when JWT_SECRET is not set', () => {
      const emptyConfig = new ConfigService({});
      const customService = new BillReceiptService(prisma, emptyConfig);
      const code = customService.computeVerifyCode('R20261025000001', 1000, '2026-10-25T00:00:00.000Z');
      expect(code).toHaveLength(16);
    });

    it('maskName masks names correctly', () => {
      expect(service.maskName(null)).toBe('租客');
      expect(service.maskName('')).toBe('租客');
      expect(service.maskName('张')).toBe('张');
      expect(service.maskName('张三')).toBe('张*');
      expect(service.maskName('张三丰')).toBe('张*丰');
      expect(service.maskName('诸葛孔明')).toBe('诸*明');
    });

    it('maskPhone masks 11-digit phone numbers', () => {
      expect(service.maskPhone(null)).toBe('');
      expect(service.maskPhone('')).toBe('');
      expect(service.maskPhone('13812345678')).toBe('138****5678');
      expect(service.maskPhone('12345')).toBe('12345');
    });
  });

  describe('getReceipt', () => {
    it('returns receipt with fallbacks and payment totals', async () => {
      prisma.bill.findUnique.mockResolvedValue(
        bill({
          contract: null,
          paymentRecords: [
            {
              id: 'p1',
              receiptNumber: 'R20261025000001',
              amount: 100,
              paymentMethod: 'CASH',
              status: 'CONFIRMED',
              paidAt: new Date(),
              transactionNumber: null,
              notes: null,
            },
          ],
          lateFees: [{ confirmedAmount: 200, settledAmount: 0 }],
        }),
      );
      const result = await service.getReceipt('b1');
      expect(result.payerName).toBe('租客');
      expect(result.roomNumber).toBe('');
      expect(result.confirmedLateFee).toBe(200);
      expect(result.totalPaid).toBe(100);
      expect(result.payments[0].receiptNumber).toBe('R20261025000001');
      expect(result.payments[0].verifyCode).toHaveLength(16);
    });

    it('handles payment without receiptNumber and zero total paid', async () => {
      prisma.bill.findUnique.mockResolvedValue(
        bill({
          paidAmount: 0,
          paymentRecords: [
            {
              id: 'p1',
              receiptNumber: null,
              amount: 0,
              paymentMethod: 'OTHER',
              status: 'VOIDED',
              paidAt: new Date(),
            },
          ],
        }),
      );
      const result = await service.getReceipt('b1');
      expect(result.payments[0].verifyCode).toBe('');
      expect(result.totalPaid).toBe(0);
      expect(result.receiptNumber).toBe('RCP-BILL-1');
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

    it('handles omitted fee/payment arrays and unknown bill types', async () => {
      prisma.bill.findUnique.mockResolvedValue(bill({ billType: 'CUSTOM', paymentRecords: null, lateFees: null }));
      const result = await service.getReceipt('b1');
      expect(result.billTypeLabel).toBe('CUSTOM');
      expect(result.totalPaid).toBe(0);
      expect(result.confirmedLateFee).toBe(0);
    });
  });

  describe('getPaymentReceipt', () => {
    it('returns single payment receipt with verifyCode and status', async () => {
      const paymentDate = new Date('2026-10-25T12:00:00Z');
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        receiptNumber: 'R20261025000001',
        amount: 250000,
        status: 'CONFIRMED',
        paymentMethod: 'WECHAT',
        transactionNumber: '42000021020261025',
        paidAt: paymentDate,
        voidedAt: null,
        voidReason: null,
        bill: bill(),
      });

      const receipt = await service.getPaymentReceipt('b1', 'p1');
      expect(receipt.receiptNumber).toBe('R20261025000001');
      expect(receipt.amount).toBe(250000);
      expect(receipt.amountYuan).toBe('2500.00');
      expect(receipt.paymentMethodLabel).toBe('微信支付');
      expect(receipt.isVoided).toBe(false);
      expect(receipt.verifyCode).toHaveLength(16);
      expect(receipt.verifyUrl).toContain('R20261025000001');
    });

    it('handles fallback receiptNumber, custom method, custom bill type, and missing contract details', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        receiptNumber: null,
        amount: 5000,
        status: 'CONFIRMED',
        paymentMethod: 'CRYPTO',
        paidAt: new Date(),
        bill: {
          id: 'b1',
          billNumber: 'B1',
          billType: 'SPECIAL_SERVICE',
          period: '2026-10',
          contract: null,
        },
      });

      const receipt = await service.getPaymentReceipt('b1', 'p1');
      expect(receipt.receiptNumber).toBe('RCP-p1');
      expect(receipt.paymentMethodLabel).toBe('CRYPTO');
      expect(receipt.billTypeLabel).toBe('SPECIAL_SERVICE');
      expect(receipt.payerName).toBe('租客');
      expect(receipt.payerPhone).toBe('');
      expect(receipt.buildingName).toBe('');
      expect(receipt.roomNumber).toBe('');
    });

    it('returns voided single payment receipt', async () => {
      const paymentDate = new Date('2026-10-25T12:00:00Z');
      const voidDate = new Date('2026-10-25T14:00:00Z');
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        receiptNumber: 'R20261025000001',
        amount: 250000,
        status: 'VOIDED',
        paymentMethod: 'CASH',
        transactionNumber: null,
        paidAt: paymentDate,
        voidedAt: voidDate,
        voidReason: '租客多交退回',
        bill: bill(),
      });

      const receipt = await service.getPaymentReceipt('b1', 'p1');
      expect(receipt.isVoided).toBe(true);
      expect(receipt.status).toBe('VOIDED');
      expect(receipt.voidReason).toBe('租客多交退回');
      expect(receipt.voidedAt).toEqual(voidDate);
    });

    it('throws NotFoundException if payment not found or billId mismatch', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValueOnce(null);
      await expect(service.getPaymentReceipt('b1', 'p999')).rejects.toThrow(NotFoundException);

      prisma.paymentRecord.findUnique.mockResolvedValueOnce({
        id: 'p1',
        billId: 'different-bill',
        bill: bill(),
      });
      await expect(service.getPaymentReceipt('b1', 'p1')).rejects.toThrow(NotFoundException);
    });

    it('checks tenant isolation for single payment receipt', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        billId: 'b1',
        bill: bill({ contract: { tenantId: 't1' } }),
      });

      await expect(service.getPaymentReceipt('b1', 'p1', 'different-tenant')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMyReceipts (LSE-05 / T297)', () => {
    it('returns empty array when tenantId is not provided', async () => {
      expect(await service.findMyReceipts('')).toEqual([]);
      expect(await service.findMyReceipts(undefined)).toEqual([]);
    });

    it('returns receipt list for tenant with formatted money, verifyCode and status', async () => {
      const paidDate = new Date('2026-10-25T10:00:00Z');
      prisma.paymentRecord.findMany.mockResolvedValue([
        {
          id: 'p1',
          billId: 'b1',
          receiptNumber: 'R20261025000001',
          amount: 250000,
          status: 'CONFIRMED',
          paymentMethod: 'WECHAT',
          transactionNumber: 'WX_TRX_1',
          paidAt: paidDate,
          voidedAt: null,
          voidReason: null,
          bill: {
            id: 'b1',
            billNumber: 'BILL-001',
            billType: 'RENT',
            period: '2026-10',
            contract: {
              room: {
                roomNumber: '101',
                building: { name: 'A栋' },
              },
            },
          },
        },
        {
          id: 'p2',
          billId: 'b2',
          receiptNumber: 'R20261025000002',
          amount: 5000,
          status: 'VOIDED',
          paymentMethod: 'CUSTOM_PAY',
          transactionNumber: null,
          paidAt: paidDate,
          voidedAt: new Date('2026-10-25T12:00:00Z'),
          voidReason: '重复交款',
          bill: {
            id: 'b2',
            billNumber: 'BILL-002',
            billType: 'SPECIAL_SERVICE',
            period: '2026-10',
            contract: null,
          },
        },
      ]);

      const list = await service.findMyReceipts('t1');
      expect(list).toHaveLength(2);

      const first = list[0];
      expect(first.receiptNumber).toBe('R20261025000001');
      expect(first.amount).toBe(250000);
      expect(first.amountYuan).toBe('2500.00');
      expect(first.paymentMethodLabel).toBe('微信支付');
      expect(first.isVoided).toBe(false);
      expect(first.verifyCode).toHaveLength(16);
      expect(first.roomNumber).toBe('101');
      expect(first.buildingName).toBe('A栋');
      expect(first.receiptUrl).toBe('/api/bills/b1/payments/p1/receipt');

      const second = list[1];
      expect(second.isVoided).toBe(true);
      expect(second.voidReason).toBe('重复交款');
      expect(second.paymentMethodLabel).toBe('CUSTOM_PAY');
      expect(second.billTypeLabel).toBe('SPECIAL_SERVICE');
      expect(second.roomNumber).toBe('');
      expect(second.buildingName).toBe('');
    });
  });

  describe('verifyReceipt', () => {
    it('throws BadRequestException for empty receipt number', async () => {
      await expect(service.verifyReceipt('')).rejects.toThrow(BadRequestException);
    });

    it('returns valid=false for non-existent receipt number', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue(null);
      const res = await service.verifyReceipt('R99999999999999');
      expect(res.valid).toBe(false);
      expect(res.message).toContain('不存在');
    });

    it('returns valid=false for mismatched verifyCode', async () => {
      const paidAt = new Date('2026-10-25T10:00:00Z');
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        receiptNumber: 'R20261025000001',
        amount: 50000,
        paidAt,
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        bill: bill(),
      });

      const res = await service.verifyReceipt('R20261025000001', 'WRONGCODE1234567');
      expect(res.valid).toBe(false);
      expect(res.message).toContain('不匹配');
    });

    it('returns valid=true and masked payer information for valid receipt', async () => {
      const paidAt = new Date('2026-10-25T10:00:00Z');
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        receiptNumber: 'R20261025000001',
        amount: 50000,
        paidAt,
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        transactionNumber: 'TRX-101',
        bill: bill({
          contract: {
            tenant: { name: '张三丰', phone: '13812345678' },
            room: { roomNumber: '101', building: { name: 'A栋' } },
          },
        }),
      });

      const expectedCode = service.computeVerifyCode('R20261025000001', 50000, paidAt);
      const res = await service.verifyReceipt('R20261025000001', expectedCode.toLowerCase());

      expect(res.valid).toBe(true);
      expect(res.payerName).toBe('张*丰');
      expect(res.payerPhone).toBe('138****5678');
      expect(res.amountYuan).toBe('500.00');
      expect(res.isVoided).toBe(false);
      expect(res.message).toBe('收据真实有效');
    });

    it('handles verification with custom types and missing contract info', async () => {
      const paidAt = new Date('2026-10-25T10:00:00Z');
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        receiptNumber: 'R20261025000001',
        amount: 50000,
        paidAt,
        status: 'CONFIRMED',
        paymentMethod: 'COUPON',
        bill: {
          billNumber: 'B1',
          billType: 'CUSTOM_TYPE',
          contract: null,
        },
      });

      const res = await service.verifyReceipt('R20261025000001');
      expect(res.valid).toBe(true);
      expect(res.billTypeLabel).toBe('CUSTOM_TYPE');
      expect(res.paymentMethodLabel).toBe('COUPON');
      expect(res.buildingName).toBe('');
      expect(res.roomNumber).toBe('');
    });

    it('returns voided notification when receipt is VOIDED', async () => {
      const paidAt = new Date('2026-10-25T10:00:00Z');
      const voidedAt = new Date('2026-10-25T15:30:00Z');
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p1',
        receiptNumber: 'R20261025000001',
        amount: 50000,
        paidAt,
        status: 'VOIDED',
        voidedAt,
        voidReason: '重复交款冲正',
        paymentMethod: 'ALIPAY',
        bill: bill(),
      });

      const res = await service.verifyReceipt('R20261025000001');
      expect(res.valid).toBe(true);
      expect(res.isVoided).toBe(true);
      expect(res.voidReason).toBe('重复交款冲正');
      expect(res.message).toContain('作废');
    });
  });

  describe('generateReceiptPdf and generatePublicReceiptPdf', () => {
    it('generates PDF buffer for confirmed and voided single payment receipt', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValueOnce({
        id: 'p1',
        billId: 'b1',
        receiptNumber: 'R20261025000001',
        amount: 150000,
        status: 'CONFIRMED',
        paymentMethod: 'WECHAT',
        paidAt: new Date(),
        bill: bill(),
      });

      const pdf = await service.generateReceiptPdf('b1', 'p1');
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.subarray(0, 8).toString()).toContain('%PDF-1.4');

      prisma.paymentRecord.findUnique.mockResolvedValueOnce({
        id: 'p1',
        billId: 'b1',
        receiptNumber: 'R20261025000001',
        amount: 150000,
        status: 'VOIDED',
        voidedAt: new Date(),
        voidReason: '作废原因',
        paymentMethod: 'WECHAT',
        paidAt: new Date(),
        bill: bill(),
      });
      const voidedPdf = await service.generateReceiptPdf('b1', 'p1');
      expect(voidedPdf.toString('utf8')).toContain('VOIDED');
    });

    it('generates PDF buffer for whole bill receipt (confirmed, voided, and empty payments)', async () => {
      // confirmed
      prisma.bill.findUnique.mockResolvedValueOnce(
        bill({
          paymentRecords: [
            {
              id: 'p1',
              receiptNumber: 'R20261025000001',
              amount: 100000,
              paymentMethod: 'CASH',
              status: 'CONFIRMED',
              paidAt: new Date(),
            },
          ],
        }),
      );
      const pdf = await service.generateReceiptPdf('b1');
      expect(Buffer.isBuffer(pdf)).toBe(true);

      // all voided
      prisma.bill.findUnique.mockResolvedValueOnce(
        bill({
          paymentRecords: [
            {
              id: 'p1',
              receiptNumber: 'R20261025000001',
              amount: 100000,
              paymentMethod: 'CASH',
              status: 'VOIDED',
              paidAt: new Date(),
              voidedAt: new Date(),
              voidReason: '作废',
            },
          ],
        }),
      );
      const voidedBillPdf = await service.generateReceiptPdf('b1');
      expect(voidedBillPdf.toString('utf8')).toContain('VOIDED');

      // empty payments
      prisma.bill.findUnique.mockResolvedValueOnce(
        bill({
          paymentRecords: [],
        }),
      );
      const emptyPaymentsPdf = await service.generateReceiptPdf('b1');
      expect(Buffer.isBuffer(emptyPaymentsPdf)).toBe(true);
    });

    it('generates public receipt PDF for confirmed and voided payments with fallbacks', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValueOnce({
        id: 'p1',
        receiptNumber: 'R20261025000001',
        amount: 150000,
        status: 'CONFIRMED',
        paymentMethod: 'WECHAT',
        paidAt: new Date(),
        bill: bill(),
      });
      const pdf = await service.generatePublicReceiptPdf('R20261025000001');
      expect(Buffer.isBuffer(pdf)).toBe(true);

      prisma.paymentRecord.findUnique.mockResolvedValueOnce({
        id: 'p2',
        receiptNumber: null,
        amount: 5000,
        status: 'VOIDED',
        voidedAt: new Date(),
        voidReason: '测试作废',
        paymentMethod: 'UNKNOWN_METHOD',
        paidAt: new Date(),
        bill: {
          id: 'b1',
          billNumber: 'B1',
          billType: 'SPECIAL_FEE',
          period: '2026-10',
          contract: null,
        },
      });
      const fallbackPdf = await service.generatePublicReceiptPdf('RCP-p2');
      expect(fallbackPdf.toString('utf8')).toContain('VOIDED');
      expect(fallbackPdf.toString('utf8')).toContain('测试作废');
    });

    it('throws NotFoundException for non-existent public receipt PDF', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue(null);
      await expect(service.generatePublicReceiptPdf('R99999999999999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('recognizeVoucher', () => {
    it('recognizes voucher tags, bill references and direct ids with amount statuses', async () => {
      prisma.bill.findFirst.mockResolvedValue(
        bill({
          lateFees: [
            { confirmedAmount: 100, settledAmount: 20 },
            { confirmedAmount: null, settledAmount: null },
          ],
          paymentRecords: [{ id: 'p', amount: 10, paidAt: new Date(), paymentMethod: 'CASH' }],
        }),
      );
      expect((await service.recognizeVoucher('[VOUCHER:BILL-1:7]')).amountMatchStatus).toBe('MISMATCH');
      expect((await service.recognizeVoucher('单号：BILL-1 ¥9')).matchedBy).toBe('BILL-1');
      expect((await service.recognizeVoucher('BILL-1')).amountMatchStatus).toBe('UNKNOWN');
      expect((await service.recognizeVoucher('账单编号：BILL-1 金额：9.8')).extractedAmountCents).toBe(980);
    });

    it('matches unpaid amount when outstanding late fees exist', async () => {
      prisma.bill.findFirst.mockResolvedValue(
        bill({
          amount: 1000,
          paidAmount: 200, // unpaid 800
          lateFees: [{ confirmedAmount: 100, settledAmount: 0 }], // totalRemaining 900
        }),
      );
      const res = await service.recognizeVoucher('[VOUCHER:BILL-1:800]');
      expect(res.amountMatchStatus).toBe('MATCHED');
    });

    it('validates inputs and handles missing bills', async () => {
      for (const input of ['', '  ', 'nonsense']) {
        await expect(service.recognizeVoucher(input)).rejects.toThrow(BadRequestException);
      }
      prisma.bill.findFirst.mockResolvedValue(null);
      await expect(service.recognizeVoucher('BILL-1')).rejects.toThrow(NotFoundException);
    });

    it('returns recognized data with absent optional relations and matched amount', async () => {
      prisma.bill.findFirst.mockResolvedValue(
        bill({
          contract: null,
          amount: 1000,
          paidAmount: 0,
          billType: 'CUSTOM_MAINTENANCE',
          status: 'CANCELLED',
        }),
      );
      const result = await service.recognizeVoucher('VOUCHER:BILL-1:1000');
      expect(result.amountMatchStatus).toBe('MATCHED');
      expect(result.isCancelled).toBe(true);
      expect(result.billTypeLabel).toBe('CUSTOM_MAINTENANCE');
      expect(result.tenant.name).toBe('租客');
      expect(result.room.roomNumber).toBe('—');
    });

    it('recognizes a voucher without embedded amount', async () => {
      prisma.bill.findFirst.mockResolvedValue(bill({ status: 'PAID' }));
      const result = await service.recognizeVoucher('VOUCHER:BILL-1');
      expect(result.extractedAmountCents).toBeNull();
      expect(result.amountMatchStatus).toBe('UNKNOWN');
      expect(result.isPaid).toBe(true);
    });
  });
});
