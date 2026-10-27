import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WechatPaymentService } from './wechat-payment.service.js';
import { MockPaymentProvider } from './mock-payment.provider.js';

describe('WechatPaymentService (T293 / PAY-01)', () => {
  let service: WechatPaymentService;
  let prisma: any;
  let billPaymentService: any;
  let paymentProvider: MockPaymentProvider;
  let configService: ConfigService;

  beforeEach(() => {
    paymentProvider = new MockPaymentProvider();
    billPaymentService = {
      addPayment: vi.fn().mockResolvedValue({
        payment: { id: 'pay-001', amount: 200000, status: 'CONFIRMED' },
        bill: { id: 'bill-001', status: 'PAID' },
      }),
    };
    prisma = {
      bill: {
        findUnique: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn(),
      },
      userIdentity: {
        findFirst: vi.fn(),
      },
      lateFee: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      paymentRecord: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    configService = new ConfigService({
      NODE_ENV: 'test',
      WECHAT_PAY_MOCK: 'true',
    });

    service = new WechatPaymentService(
      prisma,
      billPaymentService,
      paymentProvider,
      configService,
    );
  });

  describe('createJsapiOrder', () => {
    it('账单不存在抛出 NotFoundException', async () => {
      prisma.bill.findUnique.mockResolvedValue(null);
      await expect(
        service.createJsapiOrder('bill-not-exist', 'u1', 'TENANT'),
      ).rejects.toThrow(NotFoundException);
    });

    it('租客支付非本人的账单时抛出 ForbiddenException (防越权)', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'bill-001',
        amount: 200000,
        paidAmount: 0,
        status: 'PENDING',
        contract: { id: 'c1', tenantId: 'tenant-owner-1' },
      });
      // 当前登录用户的租客档案为 tenant-other
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-other' });

      await expect(
        service.createJsapiOrder('bill-001', 'user-other', 'TENANT'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('已结清账单不可再次支付', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'bill-001',
        amount: 200000,
        paidAmount: 200000,
        status: 'PAID',
        contract: { id: 'c1', tenantId: 'tenant-1' },
      });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      await expect(
        service.createJsapiOrder('bill-001', 'u1', 'TENANT'),
      ).rejects.toThrow(BadRequestException);
    });

    it('正常流程生成合法的微信支付 JSAPI 调起参数', async () => {
      prisma.bill.findUnique.mockResolvedValue({
        id: 'bill-001',
        billNumber: 'B20261025-001',
        amount: 300000,
        paidAmount: 50000,
        status: 'PARTIAL',
        contract: { id: 'c1', tenantId: 'tenant-1' },
      });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.userIdentity.findFirst.mockResolvedValue({
        providerUserId: 'wx_real_openid_888',
      });

      const params = await service.createJsapiOrder('bill-001', 'u1', 'TENANT');
      expect(params.appId).toBe('wx_mock_appid');
      expect(params.package).toContain('prepay_id=mock_prepay_');
      expect(params.outTradeNo).toBeTruthy();

      const stored = paymentProvider.getOrder(params.outTradeNo);
      expect(stored?.amount).toBe(250000); // 300000 - 50000
      expect(stored?.openid).toBe('wx_real_openid_888');
    });
  });

  describe('handleNotify', () => {
    it('接收到支付成功通知后幂等入账', async () => {
      const notifyBody = {
        out_trade_no: 'WP_ORDER_999',
        transaction_id: '420000999',
        amount: { total: 250000 },
        payer: { openid: 'mock_openid' },
        attach: JSON.stringify({ billId: 'bill-001', userId: 'u1' }),
      };

      const res = await service.handleNotify({}, notifyBody);
      expect(res.code).toBe('SUCCESS');
      expect(billPaymentService.addPayment).toHaveBeenCalledWith(
        'bill-001',
        expect.objectContaining({
          amount: 250000,
          paymentMethod: 'WECHAT',
          transactionNumber: '420000999',
          idempotencyKey: 'wechat_pay_WP_ORDER_999',
        }),
        'SYSTEM_WECHAT_PAY',
      );
    });
  });

  describe('queryAndSyncPayment', () => {
    it('主动查单并在微信支付成功但本地未入账时自动补账', async () => {
      prisma.bill.findUnique
        .mockResolvedValueOnce({
          id: 'bill-001',
          contract: { tenantId: 'tenant-1' },
        })
        .mockResolvedValueOnce({
          id: 'bill-001',
          status: 'PAID',
          paymentRecords: [{ id: 'p1' }],
        });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      // 在 mock provider 中提前放一个成功的单据
      paymentProvider.simulateSuccess('WP_QUERY_001', 'tx_query_001');
      const order = paymentProvider.getOrder('WP_QUERY_001')!;
      order.amount = 180000;

      const res = await service.queryAndSyncPayment('bill-001', 'u1', 'TENANT', {
        outTradeNo: 'WP_QUERY_001',
      });

      expect(res.synced).toBe(true);
      expect(res.order?.status).toBe('SUCCESS');
      expect(billPaymentService.addPayment).toHaveBeenCalledWith(
        'bill-001',
        expect.objectContaining({
          amount: 180000,
          transactionNumber: 'tx_query_001',
          idempotencyKey: 'wechat_pay_WP_QUERY_001',
        }),
        'SYSTEM_WECHAT_PAY',
      );
    });
  });

  describe('createRefund (PAY-02)', () => {
    it('非微信收款记录不可申请退款', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-offline',
        billId: 'b1',
        paymentMethod: 'CASH',
        status: 'CONFIRMED',
        amount: 10000,
      });

      await expect(
        service.createRefund('b1', 'p-offline', { amount: 5000 }, 'admin-1'),
      ).rejects.toThrow('非微信支付收款记录');
    });

    it('退款金额超出付款金额抛出 BadRequestException', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-wechat',
        billId: 'b1',
        paymentMethod: 'WECHAT',
        status: 'CONFIRMED',
        amount: 10000,
        idempotencyKey: 'wechat_pay_WP_123',
      });

      await expect(
        service.createRefund('b1', 'p-wechat', { amount: 20000 }, 'admin-1'),
      ).rejects.toThrow('退款金额 (20000分) 超过原付款金额');
    });

    it('全额退款成功调用 voidPayment 冲正', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-wechat',
        billId: 'b1',
        paymentMethod: 'WECHAT',
        status: 'CONFIRMED',
        amount: 10000,
        idempotencyKey: 'wechat_pay_WP_123',
      });

      billPaymentService.voidPayment = vi.fn().mockResolvedValue({
        reversal: { id: 'rev-001' },
        bill: { id: 'b1', paidAmount: 0 },
      });

      const res = await service.createRefund(
        'b1',
        'p-wechat',
        { amount: 10000, outRefundNo: 'WR_REF_001' },
        'admin-1',
      );

      expect(res.refundAmount).toBe(10000);
      expect(res.status).toBe('SUCCESS');
      expect(res.reversalPaymentId).toBe('rev-001');
      expect(res.remainingPaidAmount).toBe(0);
      expect(billPaymentService.voidPayment).toHaveBeenCalledWith(
        'b1',
        'p-wechat',
        'admin-1',
        expect.stringContaining('WR_REF_001'),
      );
    });

    it('部分退款成功冲正账单部分实缴额', async () => {
      prisma.paymentRecord.findUnique.mockResolvedValue({
        id: 'p-wechat',
        billId: 'b1',
        paymentMethod: 'WECHAT',
        status: 'CONFIRMED',
        amount: 10000,
        idempotencyKey: 'wechat_pay_WP_123',
        bill: { id: 'b1', amount: 10000, paidAmount: 10000 },
      });

      prisma.$transaction = vi.fn().mockImplementation(async (cb) => {
        const tx = {
          paymentRecord: {
            create: vi.fn().mockResolvedValue({ id: 'rev-partial-001' }),
          },
          bill: {
            update: vi.fn().mockResolvedValue({ id: 'b1', paidAmount: 7000 }),
          },
        };
        return cb(tx);
      });

      const res = await service.createRefund(
        'b1',
        'p-wechat',
        { amount: 3000, outRefundNo: 'WR_PARTIAL_001' },
        'admin-1',
      );

      expect(res.refundAmount).toBe(3000);
      expect(res.reversalPaymentId).toBe('rev-partial-001');
      expect(res.remainingPaidAmount).toBe(7000);
    });
  });

  describe('reconcileWechatPayments (PAY-02)', () => {
    it('对账平账、微信单边多（自动补账）、本地单边多与金额差异精确统计', async () => {
      paymentProvider.setMockBills([
        // 1. 平账订单
        {
          tradeTime: '2026-10-27 10:00:00',
          outTradeNo: 'WP_MATCHED',
          transactionId: 'TX_MATCHED',
          amount: 50000,
          tradeState: 'SUCCESS',
        },
        // 2. 微信单边多 (REMOTE_ONLY)
        {
          tradeTime: '2026-10-27 11:00:00',
          outTradeNo: 'WP_REMOTE_ONLY',
          transactionId: 'TX_REMOTE_ONLY',
          amount: 20000,
          tradeState: 'SUCCESS',
        },
        // 3. 金额不一致 (AMOUNT_MISMATCH)
        {
          tradeTime: '2026-10-27 12:00:00',
          outTradeNo: 'WP_DIFF',
          transactionId: 'TX_DIFF',
          amount: 30000,
          tradeState: 'SUCCESS',
        },
      ]);

      prisma.paymentRecord.findMany = vi.fn().mockResolvedValue([
        // 本地平账记录
        {
          id: 'p-matched',
          amount: 50000,
          idempotencyKey: 'wechat_pay_WP_MATCHED',
          transactionNumber: 'TX_MATCHED',
        },
        // 本地金额不一致记录 (本地记了 25000，微信是 30000)
        {
          id: 'p-diff',
          amount: 25000,
          idempotencyKey: 'wechat_pay_WP_DIFF',
          transactionNumber: 'TX_DIFF',
        },
        // 本地单边多记录 (LOCAL_ONLY)
        {
          id: 'p-local-only',
          amount: 15000,
          idempotencyKey: 'wechat_pay_WP_LOCAL_ONLY',
          transactionNumber: 'TX_LOCAL_ONLY',
        },
      ]);

      const report = await service.reconcileWechatPayments({
        billDate: '2026-10-27',
        autoSyncMissing: false,
      });

      expect(report.totalWechatCount).toBe(3);
      expect(report.totalLocalCount).toBe(3);
      expect(report.matchedCount).toBe(1);
      expect(report.matchedAmount).toBe(50000);
      expect(report.remoteOnlyCount).toBe(1);
      expect(report.localOnlyCount).toBe(1);
      expect(report.amountMismatchCount).toBe(1);

      expect(report.discrepancies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'REMOTE_ONLY', outTradeNo: 'WP_REMOTE_ONLY' }),
          expect.objectContaining({ type: 'LOCAL_ONLY', outTradeNo: 'WP_LOCAL_ONLY' }),
          expect.objectContaining({ type: 'AMOUNT_MISMATCH', outTradeNo: 'WP_DIFF' }),
        ]),
      );
    });
  });
});
