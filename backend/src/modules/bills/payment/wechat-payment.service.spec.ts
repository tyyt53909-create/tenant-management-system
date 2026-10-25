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
      { handleRechargeNotify: vi.fn() } as never,
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
});
