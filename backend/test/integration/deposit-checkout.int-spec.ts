import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, prisma, resetDatabase, seedBase, setupTenancy } from './harness.js';

let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
}, 30_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('押金与退租', () => {
  it('同键退款重放只有一笔流水', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const due = new Date();
    due.setDate(due.getDate() + 7);
    const bill = await http(app).post('/bills').set(auth(tenancy.adminToken)).send({
      contractId: tenancy.contractId,
      billType: 'DEPOSIT',
      period: '2099-DEP',
      amount: 1000,
      dueDate: due.toISOString().slice(0, 10),
      snapshot: {},
    });
    expect(bill.status).toBe(201);
    const paid = await http(app)
      .post(`/bills/${bill.body.id}/payments`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 1000, paymentMethod: 'CASH' });
    expect(paid.status).toBe(201);

    const body = { amount: 400, reason: '部分退还', idempotencyKey: 'refund-once-t320' };
    const first = await http(app).post(`/deposits/${tenancy.contractId}/refund`).set(auth(tenancy.adminToken)).send(body);
    const second = await http(app).post(`/deposits/${tenancy.contractId}/refund`).set(auth(tenancy.adminToken)).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const refunds = await prisma.depositTransaction.count({
      where: { type: 'REFUND', idempotencyKey: 'refund-once-t320' },
    });
    expect(refunds).toBe(1);
    const ledger = await prisma.depositLedger.findUnique({ where: { contractId: tenancy.contractId } });
    expect(ledger?.balance).toBe(600);
  });

  it('合同房间不一致时拒绝创建退租单', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const other = await http(app).post('/rooms').set(auth(tenancy.adminToken)).send({
      buildingId: base.buildingId,
      roomNumber: `IT-OTHER-${Date.now()}`,
      floor: 1,
      roomType: 'SINGLE',
      area: 20,
    });
    expect(other.status).toBe(201);
    const created = await http(app).post('/checkout').set(auth(tenancy.adminToken)).send({
      contractId: tenancy.contractId,
      roomId: other.body.id,
      checkoutDate: new Date().toISOString().slice(0, 10),
      totalRefund: 0,
      processedBy: 'integration-admin',
      items: [],
    });
    expect(created.status).toBe(400);
  });

  it('没有押金台账时不能完成退租', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const created = await http(app).post('/checkout').set(auth(tenancy.adminToken)).send({
      contractId: tenancy.contractId,
      roomId: tenancy.roomId,
      checkoutDate: new Date().toISOString().slice(0, 10),
      totalRefund: 0,
      processedBy: 'integration-admin',
      items: [{ itemType: 'OTHER_FEE', description: '清洁', amount: 100 }],
    });
    expect(created.status).toBe(201);
    const completed = await http(app)
      .patch(`/checkout/${created.body.id}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'COMPLETED' });
    expect(completed.status).toBe(400);
    expect(JSON.stringify(completed.body)).toContain('缺少押金台账');
    const contract = await prisma.contract.findUnique({ where: { id: tenancy.contractId } });
    expect(contract?.status).toBe('ACTIVE');
  });
});
