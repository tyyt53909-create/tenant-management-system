import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';

/** FIN-03 / T267：押金账单 → 台账 → 扣减/退还/冲正（真实 DB） */
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

async function createDepositBill(adminToken: string, contractId: string, amount = 300000) {
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const response = await http(app)
    .post('/bills')
    .set(auth(adminToken))
    .send({
      contractId,
      billType: 'DEPOSIT',
      period: '2099-DEP',
      amount,
      dueDate: due.toISOString().slice(0, 10),
      snapshot: { source: 'integration' },
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

describe('押金台账', () => {
  it('押金账单收款入账，扣减与退还后归零', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await createDepositBill(tenancy.adminToken, tenancy.contractId);

    const first = await http(app)
      .post(`/bills/${bill.id}/payments`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 200000, paymentMethod: 'CASH' });
    expect(first.status).toBe(201);

    const ledger1 = await http(app)
      .get(`/deposits/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(ledger1.status).toBe(200);
    expect(ledger1.body.balance).toBe(200000);
    expect(ledger1.body.status).toBe('PARTIAL');
    expect(ledger1.body.transactions[0]).toMatchObject({ type: 'COLLECT', amount: 200000 });

    // 租客可读自己的台账
    const tenantView = await http(app)
      .get(`/deposits/${tenancy.contractId}`)
      .set(auth(tenancy.tenantToken));
    expect(tenantView.status).toBe(200);
    expect(tenantView.body.balance).toBe(200000);

    const second = await http(app)
      .post(`/bills/${bill.id}/payments`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 100000, paymentMethod: 'CASH' });
    expect(second.status).toBe(201);

    const ledger2 = await http(app)
      .get(`/deposits/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(ledger2.body.balance).toBe(300000);
    expect(ledger2.body.status).toBe('HELD');

    const deduct = await http(app)
      .post(`/deposits/${tenancy.contractId}/deduct`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 50000, reason: '墙面损坏' });
    expect(deduct.status).toBe(201);
    expect(deduct.body.balance).toBe(250000);

    const refund = await http(app)
      .post(`/deposits/${tenancy.contractId}/refund`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 250000, reason: '退租退还' });
    expect(refund.status).toBe(201);
    expect(refund.body.balance).toBe(0);
    expect(refund.body.ledger.status).toBe('REFUNDED');
  });

  it('作废押金收款同步冲减台账', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const bill = await createDepositBill(tenancy.adminToken, tenancy.contractId, 100000);

    const paid = await http(app)
      .post(`/bills/${bill.id}/payments`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 100000, paymentMethod: 'CASH' });
    expect(paid.status).toBe(201);

    const voided = await http(app)
      .post(`/bills/${bill.id}/payments/${paid.body.payment.id}/void`)
      .set(auth(tenancy.adminToken))
      .send({ reason: '录错' });
    expect(voided.status).toBe(201);

    const ledger = await http(app)
      .get(`/deposits/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(ledger.body.balance).toBe(0);
  });
});
