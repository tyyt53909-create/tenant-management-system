import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';

/** FIN-07 / T273：退租结算一致性（真实 DB） */
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

async function prepareDeposit(adminToken: string, contractId: string, amount = 300000) {
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const bill = await http(app)
    .post('/bills')
    .set(auth(adminToken))
    .send({
      contractId,
      billType: 'DEPOSIT',
      period: '2099-DEP',
      amount,
      dueDate: due.toISOString().slice(0, 10),
      snapshot: {},
    });
  expect(bill.status).toBe(201);
  const paid = await http(app)
    .post(`/bills/${bill.body.id}/payments`)
    .set(auth(adminToken))
    .send({ amount, paymentMethod: 'CASH' });
  expect(paid.status).toBe(201);
}

describe('退租结算', () => {
  it('押金扣减+退还=台账余额；完成时合同终止、房间待清洁、台账归零', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    await prepareDeposit(tenancy.adminToken, tenancy.contractId, 300000);

    const created = await http(app)
      .post('/checkout')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        roomId: tenancy.roomId,
        checkoutDate: new Date().toISOString().slice(0, 10),
        totalRefund: 250000,
        processedBy: 'integration-admin',
        notes: '集成退租',
        items: [
          { itemType: 'DEPOSIT_DEDUCTION', description: '墙面损坏', amount: 50000 },
          { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 300000 },
        ],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const checkoutId = created.body.id as string;

    const submitted = await http(app)
      .patch(`/checkout/${checkoutId}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'PENDING' });
    expect(submitted.status).toBe(200);

    const completed = await http(app)
      .patch(`/checkout/${checkoutId}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'COMPLETED' });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.processedAt).toBeTruthy();

    const contract = await http(app)
      .get(`/contracts/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(contract.body.status).toBe('TERMINATED');

    const room = await http(app).get(`/rooms/${tenancy.roomId}`).set(auth(tenancy.adminToken));
    expect(room.body.status).toBe('VACANT');
    expect(room.body.cleanStatus).toBe('PENDING_CLEAN');

    const ledger = await http(app)
      .get(`/deposits/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(ledger.body.balance).toBe(0);
    expect(ledger.body.status).toBe('REFUNDED');
    const types = (ledger.body.transactions as Array<{ type: string }>).map((row) => row.type);
    expect(types).toEqual(expect.arrayContaining(['COLLECT', 'DEDUCT', 'REFUND']));

    // 重复完成幂等，不会二次扣减押金
    const again = await http(app)
      .patch(`/checkout/${checkoutId}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'COMPLETED' });
    expect(again.status).toBe(200);
    const ledgerAgain = await http(app)
      .get(`/deposits/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(ledgerAgain.body.balance).toBe(0);
  });

  it('结算等式不成立 → 400，状态不变', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    await prepareDeposit(tenancy.adminToken, tenancy.contractId, 300000);

    const created = await http(app)
      .post('/checkout')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        roomId: tenancy.roomId,
        checkoutDate: new Date().toISOString().slice(0, 10),
        totalRefund: 999999,
        processedBy: 'integration-admin',
        items: [
          { itemType: 'DEPOSIT_DEDUCTION', description: '墙面损坏', amount: 50000 },
          { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 300000 },
        ],
      });

    await http(app)
      .patch(`/checkout/${created.body.id}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'PENDING' });

    const completed = await http(app)
      .patch(`/checkout/${created.body.id}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'COMPLETED' });
    expect(completed.status).toBe(400);

    const after = await http(app)
      .get(`/checkout/${created.body.id}`)
      .set(auth(tenancy.adminToken));
    expect(after.body.status).toBe('PENDING');
  });
});
