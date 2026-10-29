import { it } from 'vitest';
import { applyIntegrationProcessEnv, assertIntegrationEnvironment } from './guard.js';
applyIntegrationProcessEnv(assertIntegrationEnvironment(process.env), process.env);
process.env.JWT_SECRET = 'test-jwt-secret-min-32-bytes-long!';
process.env.ENCRYPTION_KEY = 'ci-test-encryption-key-32-bytes!';
it.skipIf(process.env.T308_BROWSER_FIXTURE !== 'true')('prepare browser data', async () => {
const { createApp, resetDatabase, seedBase, setupTenancy, prisma, redis } = await import('./harness.js');
const app = await createApp();
await resetDatabase();
const base = await seedBase();
const tenancy = await setupTenancy(app, base);
const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'BROWSER-RENT', billType: 'RENT', period: '2026-03', amount: 60000, snapshot: {}, dueDate: new Date('2026-03-10') } });
const payment = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 70000, billPortion: 60000, lateFeePortion: 10000, allocationVerified: true, paymentMethod: 'CASH', paidAt: new Date('2026-03-03T00:00:00Z'), confirmedBy: base.adminId } });
const refund = await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: 'BROWSER-REFUND', amount: 15000, status: 'SUCCESS', successAt: new Date('2026-03-04T00:00:00Z'), operatorId: base.adminId } });
await prisma.paymentRecord.create({ data: { billId: bill.id, amount: -15000, billPortion: -10000, lateFeePortion: -5000, allocationVerified: true, refundReversalId: refund.id, status: 'REVERSAL', paymentMethod: 'CASH', paidAt: new Date('2026-03-04T00:00:00Z'), confirmedBy: base.adminId } });
await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 1000, paymentMethod: 'CASH', paidAt: new Date('2026-03-05T00:00:00Z'), confirmedBy: base.adminId } });
const source = await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 5000, billPortion: 5000, allocationVerified: true, status: 'VOIDED', paymentMethod: 'CASH', paidAt: new Date('2026-02-03T00:00:00Z'), confirmedBy: base.adminId } });
await prisma.paymentRecord.create({ data: { billId: bill.id, amount: -5000, billPortion: -5000, reversalOfId: source.id, status: 'REVERSAL', paymentMethod: 'CASH', paidAt: new Date('2026-03-06T00:00:00Z'), confirmedBy: base.adminId } });
await prisma.refundRecord.create({ data: { paymentRecordId: payment.id, billId: bill.id, outRefundNo: 'BROWSER-UNDATED', amount: 1000, status: 'SUCCESS', operatorId: base.adminId } });
await prisma.building.create({ data: { name: '空测试楼栋', floors: 1 } });
console.log(`SYNTHETIC_BROWSER_BUILDING=${base.buildingId}`);
await app.close(); await redis.quit();

});
