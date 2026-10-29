import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy } from './harness.js';
import { BillPaymentService } from '../../src/modules/bills/bill-payment.service.js';
import { PaymentRefundService } from '../../src/modules/bills/payment/payment-refund.service.js';
import { AuditLogService } from '../../src/modules/audit/audit-log.service.js';

process.env.WECHAT_PAY_MOCK = 'true';

let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); });

describe('退款本金分配的已知缺陷', () => {
  it('多次部分退款的本金合计不得超过原收款本金', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'REFUND-REPRO', billType: 'RENT', period: '2026-02', amount: 60000, paidAmount: 60000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const fee = await prisma.lateFee.create({ data: { billId: bill.id, suggestedAmount: 40000, confirmedAmount: 40000, settledAmount: 40000, overdueDays: 1, calculation: {} } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 60000, lateFeePortion: 40000, lateFeeAllocations: [{ lateFeeId: fee.id, amount: 40000 }], allocationVerified: true, paymentMethod: 'CASH', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    const service = app.get(BillPaymentService);
    for (const index of [1, 2]) {
      await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: `REPRO-${index}`, amount: 40000, operatorId: base.adminId } });
      await service.applyRefundReversal({ billId: bill.id, paymentId: payment.id, refundAmount: 40000, outRefundNo: `REPRO-${index}`, operatorId: base.adminId });
    }
    const reversals = await prisma.paymentRecord.findMany({ where: { billId: bill.id, status: 'REVERSAL' } });
    expect(reversals.reduce((sum, reversal) => sum - reversal.billPortion, 0)).toBe(60000);
    expect(reversals.reduce((sum, reversal) => sum - reversal.lateFeePortion, 0)).toBe(20000);
  });
  it('累计全额退款后原收款应关闭，避免再次作废', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'REFUND-FULL-REPRO', billType: 'RENT', period: '2026-02', amount: 100000, paidAmount: 100000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 100000, lateFeePortion: 0, allocationVerified: true, paymentMethod: 'CASH', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    const service = app.get(BillPaymentService);
    for (const index of [1, 2]) {
      await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: `FULL-REPRO-${index}`, amount: 50000, operatorId: base.adminId } });
      await service.applyRefundReversal({ billId: bill.id, paymentId: payment.id, refundAmount: 50000, outRefundNo: `FULL-REPRO-${index}`, operatorId: base.adminId });
    }
    expect((await prisma.paymentRecord.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('VOIDED');
  });

  it('冲正提交后回调重试应能收尾而非唯一键异常', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'REFUND-RETRY-REPRO', billType: 'RENT', period: '2026-02', amount: 100000, paidAmount: 100000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 100000, lateFeePortion: 0, allocationVerified: true, paymentMethod: 'CASH', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    const service = app.get(BillPaymentService);
    const request = { billId: bill.id, paymentId: payment.id, refundAmount: 40000, outRefundNo: 'RETRY-REPRO', operatorId: base.adminId };
    await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: request.outRefundNo, amount: request.refundAmount, operatorId: base.adminId } });
    await service.applyRefundReversal(request);
    await expect(service.applyRefundReversal(request)).resolves.toBeDefined();
    const savedRefund = await prisma.refundRecord.findUniqueOrThrow({ where: { outRefundNo: request.outRefundNo } });
    expect(savedRefund.successAt).toBeNull(); // 没有通道完成时间，不推断退款月份
  });

  it('真实回调中故障回滚并可重试，同一通知并发只记一次且退款后不可作废', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'CALLBACK-ROLLBACK', billType: 'RENT', period: '2026-02', amount: 100000, paidAmount: 100000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 100000, lateFeePortion: 0, allocationVerified: true, paymentMethod: 'WECHAT', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    const refund = await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: 'CALLBACK-ROLLBACK', amount: 40000, operatorId: base.adminId } });
    const service = app.get(PaymentRefundService);
    const notify = { out_refund_no: refund.outRefundNo, refund_id: 'WX-CALLBACK-ROLLBACK', refund_status: 'SUCCESS', amount: { refund: 40000, total: 100000 } };
    await expect(service.handleRefundNotify({}, { ...notify, amount: { refund: 50000, total: 100000 } })).rejects.toThrow('退款金额与申请不一致');
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('PROCESSING');
    const failure = vi.spyOn(app.get(AuditLogService), 'recordEvent').mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(service.handleRefundNotify({}, notify)).rejects.toThrow('synthetic failure');
    failure.mockRestore();
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('PROCESSING');
    expect(await prisma.paymentRecord.count({ where: { refundReversalId: refund.id } })).toBe(0);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).paidAmount).toBe(100000);
    await Promise.all([service.handleRefundNotify({}, notify), service.handleRefundNotify({}, notify)]);
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('SUCCESS');
    expect(await prisma.paymentRecord.count({ where: { refundReversalId: refund.id } })).toBe(1);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).paidAmount).toBe(60000);
    await expect(app.get(BillPaymentService).voidPayment(bill.id, payment.id, base.adminId, '重复作废')).rejects.toThrow('不能再次作废');
    expect((await prisma.paymentRecord.findUniqueOrThrow({ where: { id: payment.id } })).paidAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('同一原款的不同部分退款并发时累计本金与费用正确', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'CALLBACK-CONCURRENT', billType: 'RENT', period: '2026-02', amount: 60000, paidAmount: 60000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const fee = await prisma.lateFee.create({ data: { billId: bill.id, suggestedAmount: 40000, confirmedAmount: 40000, settledAmount: 40000, overdueDays: 1, calculation: {} } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 60000, lateFeePortion: 40000, lateFeeAllocations: [{ lateFeeId: fee.id, amount: 40000 }], allocationVerified: true, paymentMethod: 'WECHAT', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    const refunds = await Promise.all([1, 2].map(index => prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: `CALLBACK-${index}`, amount: 40000, operatorId: base.adminId } })));
    const service = app.get(PaymentRefundService);
    await Promise.all(refunds.map((refund, index) => service.handleRefundNotify({}, { out_refund_no: refund.outRefundNo, refund_id: `WX-CALLBACK-${index}`, refund_status: 'SUCCESS', amount: { refund: 40000, total: 100000 } })));
    const reversals = await prisma.paymentRecord.findMany({ where: { billId: bill.id, status: 'REVERSAL' } });
    expect(reversals).toHaveLength(2);
    expect(reversals.reduce((sum, item) => sum - item.billPortion, 0)).toBe(60000);
    expect(reversals.reduce((sum, item) => sum - item.lateFeePortion, 0)).toBe(20000);
    expect((await prisma.lateFee.findUniqueOrThrow({ where: { id: fee.id } })).settledAmount).toBe(20000);
  });

  it('历史成功退款没有可验证的冲正关联时拒绝推断与写入', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'HISTORIC-UNKNOWN', billType: 'RENT', period: '2026-02', amount: 100000, paidAmount: 100000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 100000, lateFeePortion: 0, allocationVerified: true, paymentMethod: 'WECHAT', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: 'HISTORY', amount: 20000, status: 'SUCCESS', operatorId: base.adminId } });
    const refund = await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: 'AFTER-HISTORY', amount: 10000, operatorId: base.adminId } });
    await expect(app.get(BillPaymentService).applyRefundReversal({ billId: bill.id, paymentId: payment.id, refundAmount: 10000, outRefundNo: refund.outRefundNo, operatorId: base.adminId })).rejects.toThrow('历史退款缺少可靠冲正关联');
    expect(await prisma.paymentRecord.count({ where: { refundReversalId: refund.id } })).toBe(0);
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('PROCESSING');
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).paidAmount).toBe(100000);
  });

  it('缺失前一笔滞纳金分配时两次退款均拒绝，不误扣后一笔', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'MISSING-FEE', billType: 'RENT', period: '2026-02', amount: 1, paidAmount: 1, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const fee = await prisma.lateFee.create({ data: { billId: bill.id, suggestedAmount: 100, confirmedAmount: 100, settledAmount: 100, overdueDays: 1, calculation: {} } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 200, billPortion: 0, lateFeePortion: 200, lateFeeAllocations: [{ lateFeeId: 'synthetic-missing', amount: 100 }, { lateFeeId: fee.id, amount: 100 }], allocationVerified: true, paymentMethod: 'WECHAT', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    for (const index of [1, 2]) {
      const outRefundNo = `MISSING-FEE-${index}`;
      await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo, amount: 100, operatorId: base.adminId } });
      await expect(app.get(BillPaymentService).applyRefundReversal({ billId: bill.id, paymentId: payment.id, refundAmount: 100, outRefundNo, operatorId: base.adminId })).rejects.toThrow('滞纳金分配记录缺失');
    }
    expect((await prisma.lateFee.findUniqueOrThrow({ where: { id: fee.id } })).settledAmount).toBe(100);
    expect(await prisma.paymentRecord.count({ where: { billId: bill.id, status: 'REVERSAL' } })).toBe(0);
  });
  it('跨两笔滞纳金分配的连续部分退款不重复冲同一笔', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'TWO-FEES', billType: 'RENT', period: '2026-02', amount: 1, paidAmount: 1, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const fees = await Promise.all([1, 2].map(() => prisma.lateFee.create({ data: { billId: bill.id, suggestedAmount: 100, confirmedAmount: 100, settledAmount: 100, overdueDays: 1, calculation: {} } })));
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 200, billPortion: 0, lateFeePortion: 200, lateFeeAllocations: fees.map(fee => ({ lateFeeId: fee.id, amount: 100 })), allocationVerified: true, paymentMethod: 'WECHAT', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    for (const index of [1, 2]) {
      const outRefundNo = `TWO-FEES-${index}`;
      await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo, amount: 100, operatorId: base.adminId } });
      await app.get(BillPaymentService).applyRefundReversal({ billId: bill.id, paymentId: payment.id, refundAmount: 100, outRefundNo, operatorId: base.adminId });
    }
    expect((await prisma.lateFee.findMany({ where: { id: { in: fees.map(f => f.id) } } })).map(f => f.settledAmount)).toEqual([0, 0]);
  });
  it('已成功但缺少完成时间时可信同一事件可补证，冲突时间或原款拒绝且不再冲正', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'EVIDENCE', billType: 'RENT', period: '2026-02', amount: 100000, paidAmount: 100000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 100000, lateFeePortion: 0, allocationVerified: true, paymentMethod: 'WECHAT', transactionNumber: 'WX-ORIGINAL', idempotencyKey: 'wechat_pay_TRADE-ORIGINAL', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    const refund = await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: 'EVIDENCE-1', amount: 40000, operatorId: base.adminId } });
    const service = app.get(PaymentRefundService);
    const callback = { out_refund_no: refund.outRefundNo, refund_id: 'WX-EVIDENCE', refund_status: 'SUCCESS', transaction_id: 'WX-ORIGINAL', out_trade_no: 'TRADE-ORIGINAL', amount: { total: 100000, refund: 40000 } };
    await service.handleRefundNotify({}, callback);
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).successAt).toBeNull();
    await service.handleRefundNotify({}, { ...callback, success_time: '2026-03-01T00:00:00Z' });
    expect((await prisma.refundRecord.findUniqueOrThrow({ where: { id: refund.id } })).successAt?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    await expect(service.handleRefundNotify({}, { ...callback, success_time: '2026-03-02T00:00:00Z' })).rejects.toThrow('完成时间与已有记录不一致');
    await expect(service.handleRefundNotify({}, { ...callback, transaction_id: 'OTHER' })).rejects.toThrow('原交易编号不一致');
    expect(await prisma.paymentRecord.count({ where: { refundReversalId: refund.id } })).toBe(1);
  });

  it('原收款来源未核实时新退款分配不可标记为已验证', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'UNKNOWN-ORIGINAL', billType: 'RENT', period: '2026-02', amount: 100000, paidAmount: 100000, status: 'PAID', snapshot: {}, dueDate: new Date('2026-02-10') } });
    const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 100000, billPortion: 100000, lateFeePortion: 0, paymentMethod: 'WECHAT', paidAt: new Date('2026-02-01T00:00:00Z'), confirmedBy: base.adminId } });
    const refund = await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: 'UNKNOWN-ORIGINAL', amount: 40000, operatorId: base.adminId } });
    await app.get(BillPaymentService).applyRefundReversal({ billId: bill.id, paymentId: payment.id, refundAmount: 40000, outRefundNo: refund.outRefundNo, operatorId: base.adminId });
    expect((await prisma.paymentRecord.findUniqueOrThrow({ where: { refundReversalId: refund.id } })).allocationVerified).toBeNull();
  });

});
