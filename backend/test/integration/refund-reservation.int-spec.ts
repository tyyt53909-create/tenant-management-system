import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy } from './harness.js';
import { PaymentRefundService } from '../../src/modules/bills/payment/payment-refund.service.js';
import { BillPaymentService } from '../../src/modules/bills/bill-payment.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../src/modules/bills/payment/payment-provider.js';

process.env.WECHAT_PAY_MOCK = 'true';
let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); vi.restoreAllMocks(); });

async function setup() {
  const base = await seedBase();
  const tenancy = await setupTenancy(app, base);
  const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'RESERVATION', billType: 'RENT', period: '2026-02', amount: 100000, paidAmount: 100000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
  const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 100000, lateFeePortion: 0, allocationVerified: true, paymentMethod: 'WECHAT', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
  return { base, bill, payment, service: app.get(PaymentRefundService), provider: app.get<PaymentProvider>(PAYMENT_PROVIDER) };
}

describe('退款预留与重试', () => {
  it('不同请求并发超额时只能预留一笔', async () => {
    const { base, bill, payment, service, provider } = await setup();
    const call = vi.spyOn(provider, 'createRefund').mockImplementation(async request => ({ outRefundNo: request.outRefundNo, refundId: `wx-${request.outRefundNo}`, status: 'PROCESSING', amount: request.amount }));
    const attempts = await Promise.allSettled(['r1', 'r2'].map(requestKey => service.createRefund(bill.id, payment.id, { requestKey, amount: 60000 }, base.adminId)));
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect((await prisma.refundRecord.findMany({ where: { paymentRecordId: payment.id } })).reduce((n, r) => n + r.amount, 0)).toBe(60000);
  });
  it('网络不确定与失败通知不释放预留，同键重试不再次调用渠道，迟到成功可收尾', async () => {
    const { base, bill, payment, service, provider } = await setup();
    const call = vi.spyOn(provider, 'createRefund').mockRejectedValue(new Error('network uncertain'));
    await expect(service.createRefund(bill.id, payment.id, { requestKey: 'lost-response', amount: 60000 }, base.adminId)).rejects.toThrow();
    const retry = await service.createRefund(bill.id, payment.id, { requestKey: 'lost-response', amount: 60000 }, base.adminId);
    expect(call).toHaveBeenCalledTimes(1);
    const refund = retry.refund!;
    await service.handleRefundNotify({}, { out_refund_no: refund.outRefundNo, refund_id: 'WX-LOST', refund_status: 'CLOSED', amount: { total: 100000, refund: 60000 } });
    await expect(service.createRefund(bill.id, payment.id, { requestKey: 'new-key', amount: 50000 }, base.adminId)).rejects.toThrow();
    await service.handleRefundNotify({}, { out_refund_no: refund.outRefundNo, refund_id: 'WX-LOST', refund_status: 'SUCCESS', amount: { total: 100000, refund: 60000 } });
    await service.handleRefundNotify({}, { out_refund_no: refund.outRefundNo, refund_id: 'WX-LOST', refund_status: 'CLOSED', amount: { total: 100000, refund: 60000 } });
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('SUCCESS');
    expect(await prisma.paymentRecord.count({ where: { refundReversalId: refund.id } })).toBe(1);
  });
  it('同一键并发只调用一次渠道，语义不同的重试被拒绝', async () => {
    const { base, bill, payment, service, provider } = await setup();
    const call = vi.spyOn(provider, 'createRefund').mockImplementation(async request => ({ outRefundNo: request.outRefundNo, refundId: `wx-${request.outRefundNo}`, status: 'PROCESSING', amount: request.amount }));
    const dto = { requestKey: 'same-key', amount: 40000 };
    const responses = await Promise.all([service.createRefund(bill.id, payment.id, dto, base.adminId), service.createRefund(bill.id, payment.id, dto, base.adminId)]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(responses[0].refund?.id).toBe(responses[1].refund?.id);
    await expect(service.createRefund(bill.id, payment.id, { ...dto, amount: 30000 }, base.adminId)).rejects.toThrow('原请求不一致');
    await expect(service.createRefund(bill.id, payment.id, dto, 'different-admin')).rejects.toThrow('原请求不一致');
    expect(await prisma.refundRecord.count({ where: { paymentRecordId: payment.id } })).toBe(1);
  });
  it('退款申请与纯作废并发时只能有一方成功', async () => {
    const { base, bill, payment, service, provider } = await setup();
    const call = vi.spyOn(provider, 'createRefund').mockImplementation(async request => ({ outRefundNo: request.outRefundNo, refundId: `wx-${request.outRefundNo}`, status: 'PROCESSING', amount: request.amount }));
    const result = await Promise.allSettled([
      service.createRefund(bill.id, payment.id, { requestKey: 'void-race', amount: 50000 }, base.adminId),
      app.get(BillPaymentService).voidPayment(bill.id, payment.id, base.adminId, 'test'),
    ]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const records = await prisma.refundRecord.count({ where: { paymentRecordId: payment.id } });
    const reversed = await prisma.paymentRecord.count({ where: { reversalOfId: payment.id } });
    expect(records + reversed).toBe(1);
    expect(call).toHaveBeenCalledTimes(records);
  });

  it('渠道直接返回 FAILED 时额度仍保留，迟到成功不超过原款', async () => {
    const { base, bill, payment, service, provider } = await setup();
    const call = vi.spyOn(provider, 'createRefund').mockImplementation(async request => ({ outRefundNo: request.outRefundNo, refundId: `wx-${request.outRefundNo}`, status: 'FAILED', amount: request.amount }));
    const initial = await service.createRefund(bill.id, payment.id, { requestKey: 'failed-reserved', amount: 60000 }, base.adminId);
    expect(initial.refund?.status).toBe('FAILED');
    await expect(service.createRefund(bill.id, payment.id, { requestKey: 'failed-new', amount: 50000 }, base.adminId)).rejects.toThrow('超过可退余额');
    await service.handleRefundNotify({}, { out_refund_no: initial.refund!.outRefundNo, refund_id: initial.refund!.refundId, refund_status: 'SUCCESS', amount: { total: 100000, refund: 60000 } });
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: initial.refund!.id } })).status).toBe('SUCCESS');
    expect(call).toHaveBeenCalledTimes(1);
  });

});
