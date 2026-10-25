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

describe('账单写入不能伪造实收', () => {
  it('PATCH 不能写入 paidAmount 或直接标成已缴', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await http(app).post('/bills').set(auth(tenancy.adminToken)).send({
      contractId: tenancy.contractId,
      billType: 'RENT',
      period: '2026-10',
      amount: 300000,
      dueDate: '2026-10-05',
    });
    expect(bill.status).toBe(201);

    const forgedAmount = await http(app)
      .patch(`/bills/${bill.body.id}`)
      .set(auth(tenancy.adminToken))
      .send({ paidAmount: 300000 });
    expect(forgedAmount.status).toBe(400);

    const forgedStatus = await http(app)
      .patch(`/bills/${bill.body.id}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'PAID' });
    expect(forgedStatus.status).toBe(409);
    expect(forgedStatus.body.code).toBe('BILL_DERIVED_FIELD');

    const stored = await prisma.bill.findUnique({ where: { id: bill.body.id } });
    expect(stored?.paidAmount).toBe(0);
    expect(stored?.status).not.toBe('PAID');
  });

  it('全额收款后同键重放返回原记录', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await http(app).post('/bills').set(auth(tenancy.adminToken)).send({
      contractId: tenancy.contractId,
      billType: 'OTHER',
      period: '2026-10',
      amount: 1000,
      dueDate: '2026-10-05',
    });
    expect(bill.status).toBe(201);

    const payload = { amount: 1000, paymentMethod: 'CASH', idempotencyKey: 'pay-once-t318' };
    const first = await http(app)
      .post(`/bills/${bill.body.id}/payments`)
      .set(auth(tenancy.adminToken))
      .send(payload);
    expect(first.status).toBe(201);
    const second = await http(app)
      .post(`/bills/${bill.body.id}/payments`)
      .set(auth(tenancy.adminToken))
      .send(payload);
    expect(second.status).toBe(201);
    expect(second.body.payment.id).toBe(first.body.payment.id);
    expect(await prisma.paymentRecord.count({ where: { billId: bill.body.id } })).toBe(1);
  });
});
