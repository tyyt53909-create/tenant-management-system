import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AuditLogService } from '../../src/modules/audit/audit-log.service.js';
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

describe('concurrent bill mutations', () => {
  async function concurrentPair(
    first: () => PromiseLike<import('supertest').Response>,
    second: () => PromiseLike<import('supertest').Response>,
    firstAction: string,
  ) {
    const audit = app.get(AuditLogService);
    const record = audit.recordEvent.bind(audit);
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(audit, 'recordEvent').mockImplementation(async (event) => {
      if (event.action === firstAction) {
        entered();
        await gate;
      }
      return record(event);
    });
    const firstRequest = Promise.resolve(first());
    let secondRequest: Promise<import('supertest').Response> | undefined;
    try {
      await Promise.race([
        ready,
        firstRequest.then((response) => {
          throw new Error('First write unexpectedly finished before committing: ' + response.status);
        }),
      ]);
      secondRequest = Promise.resolve(second());
      // Wait for a real PostgreSQL lock wait, not an assumed timing window.
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const [result] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND query ILIKE '%FROM bills%'
              AND cardinality(pg_blocking_pids(pid)) > 0
          ) AS blocked
        `;
        blocked = result.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      release();
      return await Promise.all([firstRequest, secondRequest]);
    } finally {
      release();
      await Promise.allSettled(secondRequest ? [firstRequest, secondRequest] : [firstRequest]);
      spy.mockRestore();
    }
  }

  it.each([
    { operation: 'cancel', paymentFirst: true },
    { operation: 'reduce', paymentFirst: true },
    { operation: 'cancel', paymentFirst: false },
    { operation: 'reduce', paymentFirst: false },
  ])('$operation with paymentFirst=$paymentFirst', async ({ operation, paymentFirst }) => {
    const tenant = await setupTenancy(app, await seedBase());
    const created = await http(app).post('/bills').set(auth(tenant.adminToken)).send({
      contractId: tenant.contractId,
      billType: 'OTHER',
      period: '2026-10',
      amount: 3000,
      dueDate: '2026-12-01',
    });
    expect(created.status).toBe(201);
    const id: string = created.body.id;
    const pay = () => http(app).post('/bills/' + id + '/payments').set(auth(tenant.adminToken))
      .send({ amount: 2000, paymentMethod: 'CASH', idempotencyKey: 'core01-concurrent' });
    const cancel = operation === 'cancel';
    const change = () => http(app).patch('/bills/' + id).set(auth(tenant.adminToken))
      .send(cancel ? { status: 'CANCELLED' } : { amount: 1000 });
    const changeAction = cancel ? 'BILL_CANCEL' : 'BILL_UPDATE';

    const [winner, loser] = await concurrentPair(
      paymentFirst ? pay : change,
      paymentFirst ? change : pay,
      paymentFirst ? 'BILL_PAYMENT' : changeAction,
    );
    expect(winner.status).toBe(paymentFirst ? 201 : 200);
    expect(loser.status).toBe(paymentFirst ? (cancel ? 422 : 409) : 400);
    if (paymentFirst) {
      expect(loser.body.code).toBe(cancel ? 'BILL_CANNOT_CANCEL' : 'BILL_AMOUNT_LOCKED');
    }

    const [bill, payments, audits] = await Promise.all([
      prisma.bill.findUniqueOrThrow({ where: { id } }),
      prisma.paymentRecord.findMany({ where: { billId: id } }),
      prisma.auditLog.findMany({
        where: { entityId: id, action: { in: ['BILL_PAYMENT', changeAction] } },
      }),
    ]);
    expect(bill.paidAmount).toBe(paymentFirst ? 2000 : 0);
    expect(bill.amount).toBe(!paymentFirst && !cancel ? 1000 : 3000);
    expect(bill.status).toBe(paymentFirst ? 'PARTIAL' : cancel ? 'CANCELLED' : 'PENDING');
    expect(payments.map((payment) => payment.amount)).toEqual(paymentFirst ? [2000] : []);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe(paymentFirst ? 'BILL_PAYMENT' : changeAction);
    expect(audits[0].userId).not.toBeNull();
  }, 30_000);

  it('rolls back prepay with the receipt and debits once on same-key retry', async () => {
    const tenant = await setupTenancy(app, await seedBase());
    const account = await prisma.prepayAccount.create({
      data: { tenantId: tenant.tenantId, roomId: tenant.roomId, balanceCache: 5000 },
    });
    const created = await http(app).post('/bills').set(auth(tenant.adminToken)).send({
      contractId: tenant.contractId,
      billType: 'OTHER',
      period: '2026-10',
      amount: 3000,
      dueDate: '2026-12-01',
    });
    expect(created.status).toBe(201);
    const id: string = created.body.id;
    const submit = (amount = 2000) =>
      http(app).post('/bills/' + id + '/pay/prepay').set(auth(tenant.adminToken))
        .send({ amount, idempotencyKey: 'core01-prepay' });
    const audit = app.get(AuditLogService);
    const spy = vi.spyOn(audit, 'recordEvent').mockRejectedValueOnce(new Error('test-only audit failure'));
    try {
      expect((await submit()).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: account.id } })).balanceCache).toBe(5000);
    expect(await prisma.paymentRecord.count({ where: { billId: id } })).toBe(0);
    expect(await prisma.prepayTransaction.count({ where: { relatedId: id } })).toBe(0);

    const first = await submit();
    const replay = await submit();
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect((await submit(1500)).status).toBe(409);
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: account.id } })).balanceCache).toBe(3000);
    expect(await prisma.paymentRecord.count({ where: { billId: id } })).toBe(1);
    expect(await prisma.prepayTransaction.count({ where: { relatedId: id } })).toBe(1);
  });
});
