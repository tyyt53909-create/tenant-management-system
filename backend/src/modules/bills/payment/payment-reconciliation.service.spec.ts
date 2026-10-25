import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentReconciliationService } from './payment-reconciliation.service.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { DiscrepancyResolveAction } from '../dto/reconciliation.dto.js';

describe('PaymentReconciliationService (T294 / PAY-02)', () => {
  let service: PaymentReconciliationService;
  let prisma: any;
  let billPaymentService: any;
  let paymentProvider: MockPaymentProvider;

  beforeEach(() => {
    paymentProvider = new MockPaymentProvider();
    billPaymentService = {
      addPayment: vi.fn().mockResolvedValue({
        payment: { id: 'pay-sync-1', amount: 300000 },
      }),
    };

    prisma = {
      paymentRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      paymentReconciliationBatch: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 'batch-001',
          ...data,
          createdAt: new Date(),
        })),
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
      },
      paymentReconciliationItem: {
        findUnique: vi.fn(),
        update: vi.fn().mockImplementation(({ where, data }) => ({
          id: where.id,
          ...data,
        })),
      },
      bill: {
        findFirst: vi.fn(),
      },
    };

    service = new PaymentReconciliationService(prisma, billPaymentService, paymentProvider);
  });

  describe('runReconciliation', () => {
    it('正确比对微信与系统流水并生成批次与差异项', async () => {
      // 1. 设置微信侧流水：一笔完全匹配，一笔金额差异，一笔微信有系统无 (SYSTEM_MISSING)
      paymentProvider.setMockTradeBillItems([
        {
          tradeTime: '2026-10-25 10:00:00',
          appId: 'wx1',
          mchId: 'm1',
          transactionId: 'TX_MATCH',
          outTradeNo: 'WP_MATCH',
          tradeType: 'JSAPI',
          tradeState: 'SUCCESS',
          totalAmount: 200000,
        },
        {
          tradeTime: '2026-10-25 11:00:00',
          appId: 'wx1',
          mchId: 'm1',
          transactionId: 'TX_MISMATCH',
          outTradeNo: 'WP_MISMATCH',
          tradeType: 'JSAPI',
          tradeState: 'SUCCESS',
          totalAmount: 300000, // 微信 300000
        },
        {
          tradeTime: '2026-10-25 12:00:00',
          appId: 'wx1',
          mchId: 'm1',
          transactionId: 'TX_WECHAT_ONLY',
          outTradeNo: 'WP_WECHAT_ONLY',
          tradeType: 'JSAPI',
          tradeState: 'SUCCESS',
          totalAmount: 150000,
        },
      ]);

      // 2. 设置系统侧流水：一笔完全匹配，一笔金额差异 (250000)，一笔系统有微信无 (WECHAT_MISSING)
      prisma.paymentRecord.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          transactionNumber: 'TX_MATCH',
          idempotencyKey: 'wechat_pay_WP_MATCH',
          amount: 200000,
          status: 'CONFIRMED',
          paymentMethod: 'WECHAT',
        },
        {
          id: 'pay-2',
          transactionNumber: 'TX_MISMATCH',
          idempotencyKey: 'wechat_pay_WP_MISMATCH',
          amount: 250000, // 系统 250000
          status: 'CONFIRMED',
          paymentMethod: 'WECHAT',
        },
        {
          id: 'pay-3',
          transactionNumber: 'TX_SYSTEM_ONLY',
          idempotencyKey: 'wechat_pay_WP_SYSTEM_ONLY',
          amount: 100000,
          status: 'CONFIRMED',
          paymentMethod: 'WECHAT',
        },
      ]);

      const batch = await service.runReconciliation('2026-10-25', 'admin-01');
      expect(batch).toBeDefined();
      expect(batch.matchedCount).toBe(1);
      expect(batch.discrepancyCount).toBe(3); // AMOUNT_MISMATCH + SYSTEM_MISSING + WECHAT_MISSING

      expect(prisma.paymentReconciliationBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: 'WECHAT',
            totalWechatCount: 3,
            totalWechatAmount: 650000,
            totalSystemCount: 3,
            totalSystemAmount: 550000,
            matchedCount: 1,
            discrepancyCount: 3,
            items: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({ type: 'MATCHED' }),
                expect.objectContaining({ type: 'AMOUNT_MISMATCH' }),
                expect.objectContaining({ type: 'SYSTEM_MISSING' }),
                expect.objectContaining({ type: 'WECHAT_MISSING' }),
              ]),
            }),
          }),
        }),
      );
    });
  });

  describe('queryBatches & getBatchDetail', () => {
    it('queryBatches 支持分页查询', async () => {
      prisma.paymentReconciliationBatch.findMany.mockResolvedValue([
        { id: 'b1', batchNumber: 'REC-001' },
      ]);
      prisma.paymentReconciliationBatch.count.mockResolvedValue(1);

      const res = await service.queryBatches({ page: 1, limit: 10, startDate: '2026-10-01', endDate: '2026-10-31' });
      expect(res.data).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });

    it('downloadTradeBill 抛错时抛出 BadRequestException', async () => {
      paymentProvider.downloadTradeBill = vi.fn().mockRejectedValue(new Error('network error'));
      await expect(service.runReconciliation('2026-10-25', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('getBatchDetail 批次不存在时抛出 NotFoundException', async () => {
      prisma.paymentReconciliationBatch.findUnique.mockResolvedValue(null);
      await expect(service.getBatchDetail('batch-not-exist')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveDiscrepancy', () => {
    it('明细项不存在抛出 NotFoundException', async () => {
      prisma.paymentReconciliationItem.findUnique.mockResolvedValue(null);
      await expect(
        service.resolveDiscrepancy('it-none', { action: DiscrepancyResolveAction.MANUAL_RESOLVE }, 'u1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('非 SYSTEM_MISSING 执行 AUTO_SYNC 抛出 BadRequestException', async () => {
      prisma.paymentReconciliationItem.findUnique.mockResolvedValue({
        id: 'it-wrong-type',
        type: 'AMOUNT_MISMATCH',
        resolved: false,
      });

      await expect(
        service.resolveDiscrepancy('it-wrong-type', { action: DiscrepancyResolveAction.AUTO_SYNC }, 'u1'),
      ).rejects.toThrow('仅系统漏单 (SYSTEM_MISSING) 支持自动补账');
    });

    it('缺少商户订单号执行 AUTO_SYNC 抛出 BadRequestException', async () => {
      prisma.paymentReconciliationItem.findUnique.mockResolvedValue({
        id: 'it-no-order',
        type: 'SYSTEM_MISSING',
        outTradeNo: null,
        resolved: false,
      });

      await expect(
        service.resolveDiscrepancy('it-no-order', { action: DiscrepancyResolveAction.AUTO_SYNC }, 'u1'),
      ).rejects.toThrow('缺少商户订单号');
    });

    it('未匹配到账单执行 AUTO_SYNC 抛出 BadRequestException', async () => {
      prisma.paymentReconciliationItem.findUnique.mockResolvedValue({
        id: 'it-no-bill',
        type: 'SYSTEM_MISSING',
        outTradeNo: 'WP_UNKNOWN_BILL',
        resolved: false,
      });
      prisma.bill.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveDiscrepancy('it-no-bill', { action: DiscrepancyResolveAction.AUTO_SYNC }, 'u1'),
      ).rejects.toThrow('未匹配到可自动补账的账单');
    });

    it('掉单 SYSTEM_MISSING 支持自动安全补账 AUTO_SYNC', async () => {
      prisma.paymentReconciliationItem.findUnique.mockResolvedValue({
        id: 'it-sync-1',
        type: 'SYSTEM_MISSING',
        outTradeNo: 'WP_DROP_ORDER_1',
        transactionId: 'TX_DROP_1',
        wechatAmount: 200000,
        resolved: false,
        batch: { batchNumber: 'REC-20261025-01' },
      });

      prisma.bill.findFirst.mockResolvedValue({
        id: 'bill-unpaid-1',
        status: 'PENDING',
        amount: 200000,
      });

      const res = await service.resolveDiscrepancy(
        'it-sync-1',
        { action: DiscrepancyResolveAction.AUTO_SYNC, notes: '自动补单入账' },
        'admin-01',
      );

      expect(res.resolved).toBe(true);
      expect(billPaymentService.addPayment).toHaveBeenCalledWith(
        'bill-unpaid-1',
        expect.objectContaining({
          amount: 200000,
          transactionNumber: 'TX_DROP_1',
          idempotencyKey: 'wechat_pay_WP_DROP_ORDER_1',
        }),
        'admin-01',
      );
    });

    it('人工平账 MANUAL_RESOLVE 标记 resolved 为 true 并记录操作人和备注', async () => {
      prisma.paymentReconciliationItem.findUnique.mockResolvedValue({
        id: 'it-manual-1',
        type: 'AMOUNT_MISMATCH',
        resolved: false,
        batch: { batchNumber: 'REC-001' },
      });

      const res = await service.resolveDiscrepancy(
        'it-manual-1',
        { action: DiscrepancyResolveAction.MANUAL_RESOLVE, notes: '手续费扣除导致差额，已核验' },
        'admin-02',
      );

      expect(res.resolved).toBe(true);
      expect(prisma.paymentReconciliationItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'it-manual-1' },
          data: expect.objectContaining({
            resolved: true,
            resolvedBy: 'admin-02',
            resolveNotes: '手续费扣除导致差额，已核验',
          }),
        }),
      );
    });
  });
});
