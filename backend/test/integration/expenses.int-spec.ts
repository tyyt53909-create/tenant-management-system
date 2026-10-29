import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { AuditLogService } from '../../src/modules/audit/audit-log.service.js';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';
let app: INestApplication;
beforeAll(async () => { app = await createApp(); }, 30000);
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); });
describe('T305 expense records', () => {
  it('records an unpaid expense and an idempotent payment with evidence and payment date', async () => {
    const base = await seedBase(); const token = await login(app, base.adminEmail, base.adminPassword);
    const data = { buildingId: base.buildingId, category: '维修', description: '更换灯具', amount: 12345, sourceReference: 'invoice-1', requestKey: 'create-1' };
    const [a, b] = await Promise.all([http(app).post('/expenses').set(auth(token)).send(data), http(app).post('/expenses').set(auth(token)).send(data)]);
    expect([a.status, b.status]).toEqual([201, 201]); expect(a.body.id).toBe(b.body.id);
    expect((await http(app).get('/expenses?status=UNPAID').set(auth(token)).expect(200)).body).toHaveLength(1);
    const payment = { amount: 12345, paidDate: '2026-02-14', expectedVersion: 0, evidence: 'bank-ref-1', requestKey: 'pay-1' };
    await http(app).post(`/expenses/${a.body.id}/payments`).set(auth(token)).send({ ...payment, paidDate: '2026-02-30' }).expect(400);
    await http(app).post(`/expenses/${a.body.id}/payments`).set(auth(token)).send({ ...payment, amount: 99 }).expect(400);
    expect(await prisma.expensePayment.count()).toBe(0);
    const [p, q] = await Promise.all([http(app).post(`/expenses/${a.body.id}/payments`).set(auth(token)).send(payment), http(app).post(`/expenses/${a.body.id}/payments`).set(auth(token)).send(payment)]);
    expect([p.status, q.status]).toEqual([201, 201]); expect(p.body.id).toBe(q.body.id);
    expect((await http(app).get('/expenses?status=PAID').set(auth(token)).expect(200)).body[0].payment.evidence).toBe('bank-ref-1');
    expect((await http(app).get('/expenses?status=UNPAID').set(auth(token)).expect(200)).body).toHaveLength(0);
    await http(app).post(`/expenses/${a.body.id}/payments`).set(auth(token)).send({ ...payment, requestKey: 'another' }).expect(409);
    await http(app).post('/expenses').set(auth(token)).send({ ...data, amount: 2 }).expect(409);
    await http(app).post('/expenses').set(auth(token)).send({ ...data, amount: 0, requestKey: 'bad' }).expect(400);
    await expect(prisma.$transaction(async tx => {
      await tx.operatingExpense.create({ data: { ...data, requestKey: 'rollback', createdById: base.adminId } });
      throw new Error('abort synthetic transaction');
    })).rejects.toThrow('abort synthetic transaction');
    expect(await prisma.operatingExpense.findUnique({ where: { requestKey: 'rollback' } })).toBeNull();
    expect(await prisma.operatingExpense.count()).toBe(1); expect(await prisma.expensePayment.count()).toBe(1);
  });
  it('enforces role, building scope and unique public utility source', async () => {
    const base = await seedBase(); const token = await login(app, base.adminEmail, base.adminPassword); const jwt = app.get(JwtAuthService);
    const other = await prisma.building.create({ data: { name: 'other', floors: 1 } });
    const financial = await prisma.user.create({ data: { role: 'FINANCIAL' } });
    await prisma.staffBuildingAssignment.create({ data: { userId: financial.id, buildingId: base.buildingId } });
    const ft = (await jwt.generateTokens({ sub: financial.id, role: 'FINANCIAL' })).accessToken;
    const cleaner = (await jwt.generateTokens({ sub: base.cleanerId, role: 'CLEANER' })).accessToken;
    const data = { buildingId: other.id, category: '水电', description: '水费', amount: 100, sourceReference: 'source', requestKey: 'other' };
    await http(app).post('/expenses').set(auth(cleaner)).send(data).expect(403);
    const created = await http(app).post('/expenses').set(auth(token)).send(data).expect(201);
    await http(app).get('/expenses').set(auth(ft)).expect(200).expect(r => expect(r.body).toHaveLength(0));
    await http(app).get(`/expenses?buildingId=${other.id}`).set(auth(ft)).expect(403);
    await http(app).post(`/expenses/${created.body.id}/payments`).set(auth(ft)).send({ amount: 100, paidDate: '2026-01-01', expectedVersion: 0, evidence: 'x', requestKey: 'x' }).expect(403);
    const bill = await prisma.publicUtilityBill.create({ data: { buildingId: base.buildingId, meterType: 'WATER', period: '2026-01', unitPrice: 1, totalAmount: 100, createdById: base.adminId } });
    const linked = { buildingId: base.buildingId, category: '水电', description: '水费', amount: 100, publicUtilityBillId: bill.id, requestKey: 'bill-1' };
    await http(app).post('/expenses').set(auth(ft)).send(linked).expect(201);
    await http(app).post('/expenses').set(auth(ft)).send({ ...linked, requestKey: 'bill-2' }).expect(409);
    expect(await prisma.expensePayment.count()).toBe(0);
  });
  it('audits correction and cancellation, retains the public utility source and enforces scope', async () => {
    const base = await seedBase(); const token = await login(app, base.adminEmail, base.adminPassword); const jwt = app.get(JwtAuthService);
    const other = await prisma.user.create({ data: { role: 'FINANCIAL' } });
    const ft = (await jwt.generateTokens({ sub: other.id, role: 'FINANCIAL' })).accessToken;
    const bill = await prisma.publicUtilityBill.create({ data: { buildingId: base.buildingId, meterType: 'WATER', period: '2026-02', unitPrice: 1, totalAmount: 100, createdById: base.adminId } });
    const data = { buildingId: base.buildingId, category: '水电', description: '原说明', amount: 100, publicUtilityBillId: bill.id, requestKey: 'linked' };
    const row = (await http(app).post('/expenses').set(auth(token)).send(data).expect(201)).body;
    const correction = { category: '水电', description: '更正说明', amount: 100, sourceReference: 'invoice', reason: '录入错误', expectedVersion: 0 };
    await http(app).patch(`/expenses/${row.id}`).set(auth(ft)).send(correction).expect(403);
    await http(app).post(`/expenses/${row.id}/cancel`).set(auth(ft)).send({ reason: '错误', expectedVersion: 0 }).expect(403);
    await http(app).patch(`/expenses/${row.id}`).set(auth(token)).send({ ...correction, amount: 101 }).expect(400);
    await http(app).patch(`/expenses/${row.id}`).set(auth(token)).send(correction).expect(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: row.id, action: 'EXPENSE_CORRECT' } });
    expect(audit.userId).toBe(base.adminId); expect(audit.changes).toMatchObject({ reason: '录入错误', before: { description: '原说明', amount: 100 }, after: { description: '更正说明', amount: 100 } });
    await http(app).post(`/expenses/${row.id}/cancel`).set(auth(token)).send({ reason: '作废重复单', expectedVersion: 1 }).expect(201);
    await http(app).post(`/expenses/${row.id}/cancel`).set(auth(token)).send({ reason: '作废重复单', expectedVersion: 1 }).expect(409);
    await http(app).post(`/expenses/${row.id}/payments`).set(auth(token)).send({ amount: 100, paidDate: '2026-01-01', evidence: 'x', requestKey: 'cancelled-pay', expectedVersion: 2 }).expect(409);
    await http(app).post('/expenses').set(auth(token)).send({ ...data, requestKey: 'new-linked' }).expect(409);
    expect((await http(app).get('/expenses?status=UNPAID').set(auth(token)).expect(200)).body).toHaveLength(0);
    expect((await http(app).get('/expenses?status=PAID').set(auth(token)).expect(200)).body).toHaveLength(0);
    expect((await http(app).get('/expenses?status=CANCELLED').set(auth(token)).expect(200)).body).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: row.id, action: 'EXPENSE_CANCEL' } })).toBe(1);
  });
  it('rolls back a correction when its audit event fails', async () => {
    const base = await seedBase(); const token = await login(app, base.adminEmail, base.adminPassword);
    const row = (await http(app).post('/expenses').set(auth(token)).send({ buildingId: base.buildingId, category: '维修', description: 'before', amount: 100, sourceReference: 'old', requestKey: 'audit-failure' }).expect(201)).body;
    const spy = vi.spyOn(app.get(AuditLogService), 'recordEvent').mockRejectedValueOnce(new Error('synthetic audit failure'));
    try { await http(app).patch(`/expenses/${row.id}`).set(auth(token)).send({ category: '维修', description: 'after', amount: 200, sourceReference: 'new', reason: 'fix', expectedVersion: 0 }).expect(500); }
    finally { spy.mockRestore(); }
    const saved = await prisma.operatingExpense.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved).toMatchObject({ description: 'before', amount: 100, sourceReference: 'old', version: 0 });
    expect(await prisma.auditLog.count({ where: { entityId: row.id, action: 'EXPENSE_CORRECT' } })).toBe(0);
  });
  it('serializes payment against correction and cancellation with stale version protection', async () => {
    const base = await seedBase(); const token = await login(app, base.adminEmail, base.adminPassword);
    for (const operation of ['correct', 'cancel'] as const) {
      const row = (await http(app).post('/expenses').set(auth(token)).send({ buildingId: base.buildingId, category: '维修', description: operation, amount: 100, sourceReference: 'old', requestKey: `create-${operation}` }).expect(201)).body;
      const pay = http(app).post(`/expenses/${row.id}/payments`).set(auth(token)).send({ amount: 100, paidDate: '2026-01-01', evidence: 'proof', requestKey: `pay-${operation}`, expectedVersion: 0 });
      const change = operation === 'correct'
        ? http(app).patch(`/expenses/${row.id}`).set(auth(token)).send({ category: '维修', description: 'corrected', amount: 100, sourceReference: 'new', reason: 'fix', expectedVersion: 0 })
        : http(app).post(`/expenses/${row.id}/cancel`).set(auth(token)).send({ reason: 'cancel', expectedVersion: 0 });
      const responses = await Promise.all([pay, change]);
      expect(responses.filter(r => r.status >= 200 && r.status < 300)).toHaveLength(1);
      expect(responses.filter(r => r.status === 409)).toHaveLength(1);
      const saved = await prisma.operatingExpense.findUniqueOrThrow({ where: { id: row.id }, include: { payment: true } });
      if (saved.payment) { expect(saved.sourceReference).toBe('old'); expect(saved.cancelledAt).toBeNull(); }
      else expect(saved.version).toBe(1);
    }
  });
  it('compares future payment dates against the business day at the timezone boundary', async () => {
    const base = await seedBase(); const token = await login(app, base.adminEmail, base.adminPassword);
    const row = (await http(app).post('/expenses').set(auth(token)).send({ buildingId: base.buildingId, category: '维修', description: 'date', amount: 100, sourceReference: 'source', requestKey: 'date-test' }).expect(201)).body;
    const clock = app.get(BusinessClock); const spy = vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-02-14T16:00:00Z'));
    try {
      const payment = { amount: 100, evidence: 'proof', requestKey: 'date-pay', expectedVersion: 0 };
      const legacy = await prisma.operatingExpense.create({ data: { buildingId: base.buildingId, category: '旧数据', description: 'future', amount: 100, sourceReference: 'legacy', requestKey: 'legacy-future', createdById: base.adminId, payment: { create: { amount: 100, paidDate: new Date('2026-02-16T00:00:00Z'), evidence: 'legacy', requestKey: 'legacy-pay', recordedById: base.adminId } } } });
      expect((await http(app).get('/expenses?status=PAID').set(auth(token)).expect(200)).body.some((e: { id: string }) => e.id === legacy.id)).toBe(false);
      await http(app).post(`/expenses/${row.id}/payments`).set(auth(token)).send({ ...payment, paidDate: '2026-02-16' }).expect(400);
      await http(app).post(`/expenses/${row.id}/payments`).set(auth(token)).send({ ...payment, paidDate: '2026-02-15' }).expect(201);
      await http(app).patch(`/expenses/${row.id}`).set(auth(token)).send({ category: '修改', description: 'x', amount: 100, sourceReference: 'x', reason: 'x', expectedVersion: 0 }).expect(409);
      await http(app).post(`/expenses/${row.id}/cancel`).set(auth(token)).send({ reason: 'x', expectedVersion: 0 }).expect(409);
    } finally { spy.mockRestore(); }
  });
});
