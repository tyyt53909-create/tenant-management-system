import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentRefundService } from './payment-refund.service.js';
import { MockPaymentProvider } from './mock-payment.provider.js';

describe('PaymentRefundService (T294 / PAY-02)', () => {
  let service: PaymentRefundService;
  let prisma: any;
  let billPaymentService: any;
  let paymentProvider: MockPaymentProvider;

  beforeEach(() => {
    paymentProvider = new MockPaymentProvider();
    billPaymentService = {
      applyRefundReversal: vi.fn().mockResolvedValue({
        reversal: { id: 'rev-001', amount: -200000, status: 'REVERSAL' },
        bill: { id: 'bill-001', paidAmount: 0, status: 'PENDING' },
      }),
    };

    prisma = {
      paymentRecord: {
        findUnique: vi.fn(),
      },
      refundRecord: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 'ref-db-001',
          ...data,
          createdAt: new Date(),
        })),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockImplementation(({ where, data }) => ({
          id: where.id,
          ...data,
        })),
      },
      bill: {
        findUnique: vi.fn(),
      },
    };

    prisma.$transaction = vi.fn().mockImplementation(async (callback) => callback({
      $queryRaw: vi.fn().mockResolvedValue([]),
      paymentRecord: prisma.paymentRecord,
      refundRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockImplementation(async () => ({ _sum: { amount: (await prisma.refundRecord.findMany()).reduce((sum: number, item: any) => sum + item.amount, 0) } })),
        create: prisma.refundRecord.create,
      },
    }));
    service = new PaymentRefundService(prisma, billPaymentService, paymentProvider);
  });

  describe('createRefund', () => {
    it('收款记录不存在抛出 NotFoundException', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.createRefund('b1', 'pay-none', { requestKey: 'none' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('收款非已确认状态（如已作废或冲正）不可申请退款', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'pay-voided',
        billId: 'b1',
        amount: 200000,
        status: 'VOIDED',
      });
      await expect(
        service.createRefund('b1', 'pay-voided', { requestKey: 'voided' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('退款金额超过可退余额抛出 BadRequestException', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'pay-001',
        billId: 'b1',
        amount: 200000,
        status: 'CONFIRMED',
      });
      prisma.refundRecord.findMany.mockResolvedValue([
        { id: 'r1', amount: 150000, status: 'SUCCESS' },
      ]);

      await expect(
        service.createRefund('b1', 'pay-001', { requestKey: 'excess', amount: 60000 }, 'admin-1'),
      ).rejects.toThrow('退款金额超过可退余额');
    });

    it('申请全额退款成功创建退款单', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'pay-001',
        billId: 'b1',
        amount: 200000,
        status: 'CONFIRMED',
        paymentMethod: 'WECHAT',
        transactionNumber: '42000001',
      });
      prisma.refundRecord.findUnique.mockResolvedValue({
        id: 'ref-db-001',
        status: 'PROCESSING',
        amount: 200000,
      });

      const res = await service.createRefund(
        'b1',
        'pay-001',
        { requestKey: 'success', reason: '租客多缴退款' },
        'admin-1',
      );

      expect(res.refund).toBeDefined();
      expect(prisma.refundRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billId: 'b1',
            paymentRecordId: 'pay-001',
            amount: 200000,
            status: 'PROCESSING',
          }),
        }),
      );
    });

    it('通道返回 PROCESSING 时更新 refundId 并等待异步回调通知', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'pay-proc',
        billId: 'b1',
        amount: 200000,
        status: 'CONFIRMED',
        paymentMethod: 'WECHAT',
      });
      prisma.refundRecord.findUnique.mockResolvedValue({
        id: 'ref-proc-1',
        status: 'PROCESSING',
      });

      paymentProvider.createRefund = vi.fn().mockImplementation(async (request) => ({
        outRefundNo: request.outRefundNo,
        refundId: 'WX_REF_PROC_001',
        status: 'PROCESSING',
        amount: 200000,
        userReceivedAccount: '建设银行(9999)',
      }));

      const res = await service.createRefund('b1', 'pay-proc', { requestKey: 'processing' }, 'admin-1');
      expect(res.reversal).toBeNull();
      expect(prisma.refundRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ref-db-001', status: 'PROCESSING' },
          data: expect.objectContaining({
            refundId: 'WX_REF_PROC_001',
            userReceivedAccount: '建设银行(9999)',
          }),
        }),
      );
    });

    it('通道不支持退款时抛出 BadRequestException', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'pay-001',
        billId: 'b1',
        amount: 200000,
        status: 'CONFIRMED',
      });
      (paymentProvider as any).createRefund = undefined;

      await expect(service.createRefund('b1', 'pay-001', { requestKey: 'unsupported' }, 'admin-1')).rejects.toThrow(
        '当前支付通道不支持退款操作',
      );
    });
  });

  describe('handleRefundNotify', () => {
    it('未知退款单通知抛出 NotFoundException', async () => {
      prisma.refundRecord.findUnique.mockResolvedValue(null);
      await expect(
        service.handleRefundNotify({}, { out_refund_no: 'RF_UNKNOWN' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('已完成的退款通知保持幂等返回 SUCCESS', async () => {
      prisma.refundRecord.findUnique.mockResolvedValue({
        id: 'r1',
        outRefundNo: 'RF_DONE',
        status: 'SUCCESS',
        amount: 100,
      });

      const res = await service.handleRefundNotify({}, { out_refund_no: 'RF_DONE', amount: { total: 100, refund: 100 } });
      expect(res).toEqual({ code: 'SUCCESS', message: '成功' });
      expect(billPaymentService.applyRefundReversal).toHaveBeenCalled();
    });

    it('退款成功通知触发财务冲正并将退款单更新为 SUCCESS', async () => {
      prisma.refundRecord.findUnique.mockResolvedValue({
        id: 'r1',
        billId: 'bill-001',
        paymentRecordId: 'pay-001',
        outRefundNo: 'RF_20261025',
        amount: 200000,
        status: 'PROCESSING',
        reason: '退款测试',
      });

      const notifyBody = {
        out_refund_no: 'RF_20261025',
        refund_id: 'REF_WX_999',
        amount: { total: 200000, refund: 200000 },
        user_received_account: '招商银行(0123)',
      };

      const res = await service.handleRefundNotify({}, notifyBody);
      expect(res.code).toBe('SUCCESS');
      expect(billPaymentService.applyRefundReversal).toHaveBeenCalledWith(
        expect.objectContaining({
          billId: 'bill-001',
          paymentId: 'pay-001',
          refundAmount: 200000,
          outRefundNo: 'RF_20261025',
          refundId: 'REF_WX_999',
          operatorId: 'SYSTEM_WECHAT_REFUND',
        }),
      );

      expect(prisma.refundRecord.update).not.toHaveBeenCalled(); // 状态与冲正在同一事务中由 BillPaymentService 写入

    });

    it('通道不支持解析通知时抛出 BadRequestException', async () => {
      (paymentProvider as any).verifyAndParseRefundNotify = undefined;
      await expect(service.handleRefundNotify({}, {})).rejects.toThrow(
        '当前支付通道不支持微信退款通知解析',
      );
    });

    it('退款关闭或异常时将退款单标记为 FAILED', async () => {
      prisma.refundRecord.findUnique.mockResolvedValue({
        id: 'r-fail',
        outRefundNo: 'RF_FAIL',
        status: 'PROCESSING',
      });

      const notifyBody = {
        out_refund_no: 'RF_FAIL',
        refund_id: 'REF_WX_FAIL',
        refund_status: 'CLOSED',
      };

      const res = await service.handleRefundNotify({}, notifyBody);
      expect(res.code).toBe('SUCCESS');
      expect(prisma.refundRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'r-fail', status: 'PROCESSING', OR: [{ refundId: null }, { refundId: 'REF_WX_FAIL' }] },
        data: {
          status: 'FAILED',
          refundId: 'REF_WX_FAIL',
        },
      });
    });
  });

  describe('getBillRefunds', () => {
    it('账单不存在抛出 NotFoundException', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);
      await expect(service.getBillRefunds('bill-not-exist')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('查询账单退款明细', async () => {
      prisma.bill.findUnique.mockResolvedValue({ id: 'bill-001' });
      prisma.refundRecord.findMany.mockResolvedValue([
        { id: 'ref-1', amount: 100000, status: 'SUCCESS' },
      ]);

      const list = await service.getBillRefunds('bill-001');
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('ref-1');
    });
  });
});
