import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentsController } from './payments.controller.js';
import { WechatPaymentService } from './payment/wechat-payment.service.js';
import { PaymentRefundService } from './payment/payment-refund.service.js';
import { PaymentReconciliationService } from './payment/payment-reconciliation.service.js';
import { DiscrepancyResolveAction } from './dto/reconciliation.dto.js';

describe('PaymentsController (T293 / T294 / PAY-01 / PAY-02)', () => {
  let controller: PaymentsController;
  let wechatPaymentService: any;
  let paymentRefundService: any;
  let paymentReconciliationService: any;

  beforeEach(() => {
    wechatPaymentService = {
      handleNotify: vi.fn().mockResolvedValue({ code: 'SUCCESS', message: '成功' }),
    };
    paymentRefundService = {
      handleRefundNotify: vi.fn().mockResolvedValue({ code: 'SUCCESS', message: '成功' }),
    };
    paymentReconciliationService = {
      runReconciliation: vi.fn().mockResolvedValue({ id: 'rec-1', batchNumber: 'REC-001' }),
      queryBatches: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      getBatchDetail: vi.fn().mockResolvedValue({ id: 'rec-1', items: [] }),
      resolveDiscrepancy: vi.fn().mockResolvedValue({ id: 'item-1', resolved: true }),
    };

    controller = new PaymentsController(
      wechatPaymentService as WechatPaymentService,
      paymentRefundService as PaymentRefundService,
      paymentReconciliationService as PaymentReconciliationService,
    );
  });

  it('handleWechatNotify 委托 WechatPaymentService 处理并返回结果', async () => {
    const headers = { 'wechatpay-signature': 'sig123' };
    const body = { id: 'evt-1' };

    const res = await controller.handleWechatNotify(headers, body);
    expect(res).toEqual({ code: 'SUCCESS', message: '成功' });
    expect(wechatPaymentService.handleNotify).toHaveBeenCalledWith(headers, body);
  });

  it('handleWechatRefundNotify 委托 PaymentRefundService 处理并返回结果', async () => {
    const headers = { 'wechatpay-signature': 'sig456' };
    const body = { id: 'ref-evt-1' };

    const res = await controller.handleWechatRefundNotify(headers, body);
    expect(res).toEqual({ code: 'SUCCESS', message: '成功' });
    expect(paymentRefundService.handleRefundNotify).toHaveBeenCalledWith(headers, body);
  });

  it('runReconciliation 委托 PaymentReconciliationService 执行日终对账', async () => {
    const userParam = { user: { id: 'admin-1', role: 'ADMIN' } } as any;
    const res = await controller.runReconciliation(userParam, { billDate: '2026-10-25' });

    expect(res).toEqual({ id: 'rec-1', batchNumber: 'REC-001' });
    expect(paymentReconciliationService.runReconciliation).toHaveBeenCalledWith(
      '2026-10-25',
      'admin-1',
    );
  });

  it('resolveReconciliationDiscrepancy 委托 PaymentReconciliationService 处理差异', async () => {
    const userParam = { user: { id: 'admin-1', role: 'ADMIN' } } as any;
    const res = await controller.resolveReconciliationDiscrepancy(userParam, 'item-1', {
      action: DiscrepancyResolveAction.MANUAL_RESOLVE,
      notes: '已线下核实',
    });

    expect(res.resolved).toBe(true);
    expect(paymentReconciliationService.resolveDiscrepancy).toHaveBeenCalledWith(
      'item-1',
      { action: DiscrepancyResolveAction.MANUAL_RESOLVE, notes: '已线下核实' },
      'admin-1',
    );
  });
});
