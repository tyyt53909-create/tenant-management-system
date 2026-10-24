import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';

/** FIN-06 / T265：财务资料不得硬删除（真实 DB） */
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

describe('财务资料禁止硬删除', () => {
  it('账单 DELETE → 409，记录仍存在', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const due = new Date();
    due.setDate(due.getDate() + 7);
    const bill = await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'RENT',
        period: '2099-02',
        amount: 100000,
        dueDate: due.toISOString().slice(0, 10),
        snapshot: { source: 'integration' },
      });
    expect(bill.status).toBe(201);

    const deleted = await http(app)
      .delete(`/bills/${bill.body.id}`)
      .set(auth(tenancy.adminToken));
    expect(deleted.status).toBe(409);

    const still = await http(app)
      .get(`/bills/${bill.body.id}`)
      .set(auth(tenancy.adminToken));
    expect(still.status).toBe(200);
  });

  it('已有账单的合同 DELETE → 409', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const due = new Date();
    due.setDate(due.getDate() + 7);
    await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'RENT',
        period: '2099-03',
        amount: 100000,
        dueDate: due.toISOString().slice(0, 10),
        snapshot: { source: 'integration' },
      });

    const deleted = await http(app)
      .delete(`/contracts/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(deleted.status).toBe(409);
  });
});
