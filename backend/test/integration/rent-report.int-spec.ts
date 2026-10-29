import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';

let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); });

describe('T305 租金管理口径（暂未完成）', () => {
  it('抵扣月份计租金本金、排除水电并限制租客访问', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const account = await http(app).post('/prepay-accounts').set(auth(tenancy.adminToken)).send({ tenantId: tenancy.tenantId, roomId: tenancy.roomId });
    expect(account.status).toBe(201);
    expect((await http(app).post(`/prepay-accounts/${account.body.id}/transactions`).set(auth(tenancy.adminToken)).send({ type: 'RECHARGE', amount: 100000, description: '测试充值' })).status).toBe(201);
    await prisma.prepayTransaction.updateMany({ where: { accountId: account.body.id, type: 'RECHARGE' }, data: { createdAt: new Date('2026-01-15T00:00:00Z') } });
    const bill = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'RPT-RENT', billType: 'RENT', period: '2026-01', amount: 100000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const pay = () => http(app).post(`/bills/${bill.id}/pay/prepay`).set(auth(tenancy.tenantToken)).send({ amount: 60000, idempotencyKey: 'rent-report-retry' });
    expect((await pay()).status).toBe(201);
    expect((await pay()).status).toBe(201);
    await prisma.paymentRecord.updateMany({ where: { billId: bill.id }, data: { paidAt: new Date('2026-01-31T16:30:00Z') } });
    const report = (month: string, buildingId = base.buildingId, token = tenancy.adminToken) => http(app).get('/statistics/rent-report').query({ buildingId, month }).set(auth(token));
    const jan = await report('2026-01');
    const feb = await report('2026-02');
    expect(jan.status).toBe(200);
    expect(jan.body.rentIncome).toBe(0);
    expect(feb.body.rentIncome).toBe(60000);
    expect(feb.body.currentPrepayBalance).toBe(40000);
    expect(feb.body.status).toBe('incomplete');
    expect((await report('2026-02', base.buildingId, tenancy.tenantToken)).status).toBe(403);
    const other = await prisma.building.create({ data: { name: '另一栋', floors: 1 } });
    expect((await report('2026-02', other.id)).body.rentIncome).toBe(0);
    const water = await prisma.bill.create({ data: { contractId: tenancy.contractId, billNumber: 'RPT-WATER', billType: 'UTILITY', period: '2026-02', amount: 10000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    expect((await http(app).post(`/bills/${water.id}/pay/prepay`).set(auth(tenancy.tenantToken)).send({ amount: 10000, idempotencyKey: 'water-report' })).status).toBe(201);
    await prisma.paymentRecord.updateMany({ where: { billId: water.id }, data: { paidAt: new Date('2026-02-01T00:00:00Z') } });
    expect((await report('2026-02')).body.rentIncome).toBe(60000);
    await prisma.paymentRecord.create({ data: { billId: bill.id, amount: 10000, billPortion: 5000, lateFeePortion: 5000, paymentMethod: 'CASH', paidAt: new Date('2026-02-02T00:00:00Z'), confirmedBy: base.adminId } });
    expect((await report('2026-02')).body.rentIncome).toBe(65000);
    await prisma.paymentRecord.updateMany({ where: { billId: bill.id }, data: { status: 'VOIDED' } });
    expect((await report('2026-02')).body).toMatchObject({ status: 'incomplete', hasRentAdjustments: true });
  });
});
