import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillsController } from './bills.controller.js';
import { BillsService } from './bills.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { WechatPaymentService } from './payment/wechat-payment.service.js';
import { PaymentRefundService } from './payment/payment-refund.service.js';

describe('BillsController (T293 / T294 / PAY-01 / PAY-02)', () => {
  let controller: BillsController;
  let billsService: any;
  let clock: any;
  let wechatPaymentService: any;
  let paymentRefundService: any;

  beforeEach(() => {
    billsService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      addPayment: vi.fn(),
      voidPayment: vi.fn(),
      findPayments: vi.fn(),
      addLateFee: vi.fn(),
      findLateFees: vi.fn(),
    };
    clock = {
      todayUtc: vi.fn(),
      formatDate: vi.fn(),
    };
    wechatPaymentService = {
      createJsapiOrder: vi.fn().mockResolvedValue({ appId: 'wx1', outTradeNo: 'WP_1' }),
      queryAndSyncPayment: vi.fn().mockResolvedValue({ synced: true }),
    };
    paymentRefundService = {
      createRefund: vi.fn().mockResolvedValue({ refund: { id: 'ref-1' } }),
      getBillRefunds: vi.fn().mockResolvedValue([{ id: 'ref-1' }]),
    };

    controller = new BillsController(
      billsService as BillsService,
      clock as BusinessClock,
      wechatPaymentService as WechatPaymentService,
      paymentRefundService as PaymentRefundService,
    );
  });

  it('payWithWechatJsapi 委托 WechatPaymentService 下单', async () => {
    const userParam = { user: { id: 'user-1', role: 'TENANT' } } as any;
    const res = await controller.payWithWechatJsapi(userParam, 'b1', { amount: 20000 });
    expect(res).toEqual({ appId: 'wx1', outTradeNo: 'WP_1' });
    expect(wechatPaymentService.createJsapiOrder).toHaveBeenCalledWith(
      'b1',
      'user-1',
      'TENANT',
      { amount: 20000 },
    );
  });

  it('queryWechatPayment 委托 WechatPaymentService 查单补单', async () => {
    const userParam = { user: { id: 'user-1', role: 'TENANT' } } as any;
    const res = await controller.queryWechatPayment(userParam, 'b1', { outTradeNo: 'WP_1' });
    expect(res).toEqual({ synced: true });
    expect(wechatPaymentService.queryAndSyncPayment).toHaveBeenCalledWith(
      'b1',
      'user-1',
      'TENANT',
      { outTradeNo: 'WP_1' },
    );
  });

  it('createRefund 委托 PaymentRefundService 申请退款', async () => {
    const userParam = { user: { id: 'admin-1', role: 'ADMIN' } } as any;
    const res = await controller.createRefund(userParam, 'b1', 'p1', {
      amount: 10000,
      reason: '多缴退款',
    });
    expect(res).toEqual({ refund: { id: 'ref-1' } });
    expect(paymentRefundService.createRefund).toHaveBeenCalledWith(
      'b1',
      'p1',
      { amount: 10000, reason: '多缴退款' },
      'admin-1',
    );
  });

  it('getRefunds 委托 PaymentRefundService 查询账单退款', async () => {
    const res = await controller.getRefunds('b1');
    expect(res).toEqual([{ id: 'ref-1' }]);
    expect(paymentRefundService.getBillRefunds).toHaveBeenCalledWith('b1');
  });

  it('addPayment, voidPayment, findPayments 转发给 billsService', async () => {
    const userParam = { user: { id: 'admin-1', role: 'ADMIN' } } as any;
    await controller.addPayment(userParam, 'b1', { amount: 500, paymentMethod: 'CASH' as any });
    expect(billsService.addPayment).toHaveBeenCalled();

    await controller.voidPayment(userParam, 'b1', 'p1', { reason: '作废测试' });
    expect(billsService.voidPayment).toHaveBeenCalled();

    await controller.findPayments('b1');
    expect(billsService.findPayments).toHaveBeenCalledWith('b1');
  });
});
