import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth, login } from './harness.js';
let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); });
describe('T308 当前账单清单与导出', () => {
  it('取消账单不应列出尚欠本金，列表导出按楼栋隔离且拒绝租客', async () => {
    const base = await seedBase(); const tenant = await setupTenancy(app, base);
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: base.adminId } });
    await prisma.user.create({ data: { email: 'financial@example.invalid', passwordHash: admin.passwordHash, role: 'FINANCIAL', isActive: true } });
    const financial = await login(app, 'financial@example.invalid', base.adminPassword);
    const entries = [ ['PENDING', 12345, 0], ['PARTIAL', 12345, 2345], ['PAID', 12345, 12345], ['CANCELLED', 12345, 0] ] as const;
    for (const [status, amount, paidAmount] of entries) await prisma.bill.create({ data: { contractId: tenant.contractId, billNumber: `TEST-${status}`, billType: 'RENT', period: '2026-02', amount, paidAmount, status, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const list = await http(app).get('/bills').query({ buildingId: base.buildingId }).set(auth(tenant.adminToken));
    expect(list.status).toBe(200); expect(list.body.data.filter((row: { billNumber: string }) => row.billNumber.startsWith('TEST-'))).toHaveLength(4);
    const csv = await http(app).get('/bills/export').query({ buildingId: base.buildingId }).set(auth(tenant.adminToken));
    expect(csv.status).toBe(200);
    const cancelled = csv.text.split('\r\n').find((row: string) => row.includes('TEST-CANCELLED'));
    expect(cancelled).toContain(',123.45,0.00,0.00,');
    expect(csv.text.split('\r\n').find((row: string) => row.includes('TEST-PARTIAL'))).toContain(',123.45,23.45,100.00,');
    expect(csv.text.split('\r\n').find((row: string) => row.includes('TEST-PAID'))).toContain(',123.45,123.45,0.00,');
    await prisma.tenant.update({ where: { id: tenant.tenantId }, data: { name: '=租客,\"甲\"\n乙' } });
    const special = await http(app).get('/bills/export').query({ buildingId: base.buildingId }).set(auth(tenant.adminToken));
    expect(special.text).toContain(`\"'=租客,\"\"甲\"\"\n乙\"`);
    expect((await http(app).get('/bills/export').set(auth(tenant.tenantToken))).status).toBe(403);
    expect((await http(app).get('/bills/export').set(auth(financial))).status).toBe(403);
    const other = await prisma.building.create({data:{name:'其他',floors:1}});
    expect((await http(app).get('/bills').query({buildingId:other.id}).set(auth(tenant.adminToken))).body.data).toHaveLength(0);
  });
  it('退款及纯冲正后当前未付本金与清单和导出一致，非法状态拒绝', async () => {
    const base = await seedBase(); const tenant = await setupTenancy(app, base);
    const bill = await prisma.bill.create({ data: { contractId: tenant.contractId, billNumber: 'REFUND-CURRENT', billType: 'RENT', period: '2026-02', amount: 10000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const pay = await http(app).post(`/bills/${bill.id}/payments`).set(auth(tenant.adminToken)).send({ amount: 10000, paymentMethod: 'CASH', idempotencyKey: 't308-pay' });
    expect(pay.status).toBe(201);
    const paymentId = pay.body.payment.id;
    for (const [key, amount, expected] of [['partial', 4000, 4000], ['rest', 6000, 10000]] as const) {
      const r = await http(app).post(`/bills/${bill.id}/payments/${paymentId}/refund`).set(auth(tenant.adminToken)).send({ requestKey: key, amount });
      expect(r.status).toBe(201);
      const notice = { out_refund_no: r.body.refund.outRefundNo, refund_id: r.body.refund.refundId, refund_status: 'SUCCESS', amount: { total: 10000, refund: amount } };
      expect((await http(app).post('/payments/wechat/refund-notify').send(notice)).status).toBe(200);
      expect((await http(app).post('/payments/wechat/refund-notify').send(notice)).status).toBe(200);
      const list = await http(app).get('/bills').query({contractId:tenant.contractId}).set(auth(tenant.adminToken));
      const row = list.body.data.find((item: { id: string }) => item.id === bill.id);
      expect(row.amount - row.paidAmount).toBe(expected);
      const csv = await http(app).get('/bills/export').query({contractId:tenant.contractId}).set(auth(tenant.adminToken));
      expect(csv.text.split('\r\n').find((line: string) => line.includes('REFUND-CURRENT'))).toContain(`,100.00,${((10000-expected)/100).toFixed(2)},${(expected/100).toFixed(2)},`);
    }
    const other = await prisma.bill.create({ data: { contractId: tenant.contractId, billNumber: 'VOID-CURRENT', billType: 'RENT', period: '2026-02', amount: 2300, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const collected = await http(app).post(`/bills/${other.id}/payments`).set(auth(tenant.adminToken)).send({ amount: 2300, paymentMethod: 'CASH', idempotencyKey: 't308-void-pay' });
    expect(collected.status).toBe(201);
    const voided = await http(app).post(`/bills/${other.id}/payments/${collected.body.payment.id}/void`).set(auth(tenant.adminToken)).send({ reason: '合成测试' });
    expect(voided.status).toBe(201);
    const afterVoid = await http(app).get('/bills').query({contractId:tenant.contractId}).set(auth(tenant.adminToken));
    expect(afterVoid.body.data.find((item: { id: string }) => item.id === other.id).paidAmount).toBe(0);
    const voidCsv = await http(app).get('/bills/export').query({contractId:tenant.contractId}).set(auth(tenant.adminToken));
    expect(voidCsv.text.split('\r\n').find((line: string) => line.includes('VOID-CURRENT'))).toContain(',23.00,0.00,23.00,');
    expect((await http(app).get('/bills').query({status:'BAD'}).set(auth(tenant.adminToken))).status).toBe(400);
    expect((await http(app).get('/bills/export').query({status:'BAD'}).set(auth(tenant.adminToken))).status).toBe(400);
  });

});
