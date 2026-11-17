import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma, type UtilityCollectionMode } from '@prisma/client';
import { MeterBillingService } from '../../src/modules/meters/meter-billing.service.js';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase, setupTenancy } from './harness.js';

let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
beforeEach(resetDatabase);
afterAll(async () => { await app?.close(); });

async function fixture(mode: UtilityCollectionMode = 'PREPAY_WITH_SHORTFALL', balance = 300, confirmed = true) {
  const base = await seedBase();
  const lease = await setupTenancy(app, base, { startDate: '2026-01-01' });
  const meter = await prisma.meter.create({ data: { buildingId: base.buildingId, roomId: lease.roomId, meterType: 'ELECTRICITY', meterNumber: 'POST-01', unitPrice: 9999, priceEffectiveDate: new Date('2026-01-01') } });
  const opening = await prisma.meterReading.create({ data: { meterId: meter.id, currentReading: 100, previousReading: 100, usage: 0, source: 'MANUAL', readingTime: new Date('2026-06-01T01:00:00Z'), settledAt: new Date('2026-06-01T01:00:00Z'), settledAmount: 0, notes: '[INITIAL]' } });
  const target = await prisma.meterReading.create({ data: { meterId: meter.id, currentReading: 110, previousReading: 100, usage: 10, source: 'DEVICE', readingTime: new Date('2026-06-02T01:00:00Z') } });
  const account = balance >= 0 ? await prisma.prepayAccount.create({ data: { tenantId: lease.tenantId, roomId: lease.roomId, balanceCache: balance } }) : null;
  if (account && balance) await prisma.prepayTransaction.create({ data: { accountId: account.id, type: 'RECHARGE', description: 'explicit fixture recharge', amount: balance, balanceAfter: balance, operatorId: base.adminId } });
  const rules = { meterId: meter.id, contractId: lease.contractId, responsibility: 'TENANT', openingReadingId: opening.id, collectionMode: mode, rateCents: '61.7', evidence: '已核对合同收款条款及真实入住交接底数' };
  const send = (path: string, data: object = {}) => http(app).post(path).set(auth(lease.adminToken)).send(data);
  if (confirmed) {
    const preview = await send('/utility-readiness/preview', rules);
    expect(preview.body, JSON.stringify(preview.body)).toMatchObject({ ready: true });
    expect((await send('/utility-readiness/confirm', { ...rules, requestId: randomUUID(), reviewToken: preview.body.reviewToken })).status).toBe(201);
  }
  const preview = () => send('/utility-charges/preview', { meterId: meter.id });
  const settle = () => send(`/meters/${meter.id}/settle`);
  return { ...base, ...lease, meter, opening, target, account, rules, send, preview, settle };
}
async function financial() {
  return {
    charges: await prisma.utilityCharge.findMany({ orderBy: { id: 'asc' } }),
    bills: await prisma.bill.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.paymentRecord.findMany({ orderBy: { id: 'asc' } }),
    accounts: await prisma.prepayAccount.findMany({ orderBy: { id: 'asc' } }),
    transactions: await prisma.prepayTransaction.findMany({ orderBy: { id: 'asc' } }),
    readings: await prisma.meterReading.findMany({ orderBy: { id: 'asc' } }),
    rooms: await prisma.room.findMany({ orderBy: { id: 'asc' } }),
    confirmations: await prisma.utilityPostingConfirmation.findMany(),
  };
}

it.each([
  ['PREPAY_WITH_SHORTFALL', 300, 300, 317, 0],
  ['PREPAY_WITH_SHORTFALL', 1000, 617, 0, 0],
  ['PREPAY_WITH_SHORTFALL', 0, 0, 617, 0],
  ['POSTPAID', -1, 0, 617, 0],
  ['POSTPAID', 1000, 0, 617, 0],
  ['DIRECT_TO_PROVIDER', 1000, 0, 0, 617],
  ['DIRECT_TO_PROVIDER', -1, 0, 0, 617],
] as const)('%s balance=%s persists the charge, conserved amounts and only the intended financial entries', async (mode, balance, prepay, receivable, provider) => {
  const f = await fixture(mode, balance);
  const before = await financial();
  const preview = await f.preview();
  expect(preview.body).toMatchObject({ estimatedAmount: 617, prepayApplied: prepay, receivableAmount: receivable, providerAmount: provider });
  expect(await financial()).toEqual(before);
  const command = { meterId: f.meter.id, requestId: randomUUID(), reviewToken: preview.body.reviewToken };
  const [a, b] = await Promise.all([f.send('/utility-charges/confirm', command), f.send('/utility-charges/confirm', command)]);
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  expect(b.body).toEqual(a.body);
  expect(a.body).toMatchObject({ status: 'SETTLED', amount: 617, prepayApplied: prepay, receivableAmount: receivable, providerAmount: provider });
  const charge = await prisma.utilityCharge.findFirstOrThrow();
  expect(charge).toMatchObject({ contractId: f.contractId, tenantId: f.tenantId, totalAmount: 617, prepayApplied: prepay, receivableAmount: receivable, providerAmount: provider, collectionMode: mode, notificationState: 'PENDING' });
  expect(charge.billId !== null).toBe(receivable > 0);
  expect(charge.prepayTransactionId !== null).toBe(prepay > 0);
  expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(receivable > 0 ? 1 : 0);
  expect(await prisma.prepayTransaction.count({ where: { type: 'DEDUCTION' } })).toBe(prepay > 0 ? 1 : 0);
  expect(await prisma.paymentRecord.count()).toBe(before.payments.length);
  if (f.account) expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: f.account.id } })).balanceCache).toBe(balance - prepay);
  expect((await prisma.meterReading.findUniqueOrThrow({ where: { id: f.target.id } })).settledAmount).toBe(617);
  expect(await prisma.room.findMany({ orderBy: { id: 'asc' } })).toEqual(before.rooms);
  const reconciliation = await http(app).get('/meters/reconciliation').set(auth(f.adminToken)).query({ period: '2026-06', buildingId: f.buildingId });
  expect(reconciliation.status).toBe(200);
  expect(reconciliation.body.rows).toMatchObject([{ readingAmount: 617, chargedAmount: prepay, billAmount: receivable, providerAmount: provider, difference: 0 }]);
  const snapshot = charge.snapshot as { segments: Array<{ rateCents: string; policyVersionId: string }> };
  expect(snapshot.segments).toMatchObject([{ rateCents: '61.7', policyVersionId: charge.policyVersionId }]);
  await app.close(); app = await createApp();
  expect((await f.send('/utility-charges/confirm', command)).body).toEqual(a.body);
  expect((await f.send('/utility-charges/confirm', { ...command, settleUntil: '2026-06-03T00:00:00Z' })).body.code).toBe('IDEMPOTENCY_CONFLICT');
  expect((await f.settle()).body).toMatchObject({ status: 'NO_CHANGE', reasonCode: 'ALREADY_SETTLED' });
  expect(await prisma.utilityCharge.count()).toBe(1);
});

it('serializes different request IDs, batch, periodic and manual settlement of the same source', async () => {
  const f = await fixture();
  const preview = await f.preview();
  const calls = [f.settle(), f.settle(), f.send('/meters/settle-batch', { meterIds: [f.meter.id] }),
    ...[0, 1].map(() => f.send('/utility-charges/confirm', { meterId: f.meter.id, requestId: randomUUID(), reviewToken: preview.body.reviewToken }))];
  const results = await Promise.all(calls);
  expect(results.every((r) => r.status === 201 || r.body.code === 'PREVIEW_STALE')).toBe(true);
  expect(await prisma.utilityCharge.count()).toBe(1);
  expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(1);
  expect(await prisma.prepayTransaction.count({ where: { type: 'DEDUCTION' } })).toBe(1);
  const next = await f.send(`/meters/${f.meter.id}/readings`, { currentReading: 111, readingTime: '2026-06-03T01:00:00Z', autoSettle: true });
  expect(next.body.deduction).toMatchObject({ applied: true, amount: 62 });
  const batch = await f.send('/meters/batch-readings', { readings: [{ meterId: f.meter.id, currentReading: 112, readingTime: '2026-06-04T01:00:00Z', autoSettle: true }] });
  expect(batch.body.results).toMatchObject([{ amount: 62, shortfall: 62 }]);
  expect(await prisma.utilityCharge.count()).toBe(3);
});

it('locks one shared account across different meters so concurrent charges use its entire available balance exactly once', async () => {
  const f = await fixture('PREPAY_WITH_SHORTFALL', 1000);
  const other = await prisma.meter.create({ data: { buildingId: f.buildingId, roomId: f.roomId, meterType: 'ELECTRICITY', meterNumber: 'POST-02', unitPrice: 999, priceEffectiveDate: f.opening.readingTime } });
  const opening = await prisma.meterReading.create({ data: { meterId: other.id, source: 'MANUAL', currentReading: 100, previousReading: 100, usage: 0, readingTime: f.opening.readingTime, notes: '[INITIAL]' } });
  await prisma.meterReading.create({ data: { meterId: other.id, source: 'MANUAL', currentReading: 110, previousReading: 100, usage: 10, readingTime: f.target.readingTime } });
  const dto = { ...f.rules, meterId: other.id, openingReadingId: opening.id };
  const preview = await f.send('/utility-readiness/preview', dto);
  expect(preview.body.ready).toBe(true);
  expect((await f.send('/utility-readiness/confirm', { ...dto, requestId: randomUUID(), reviewToken: preview.body.reviewToken })).status).toBe(201);
  const result = await Promise.all([f.settle(), f.send(`/meters/${other.id}/settle`)]);
  expect(result.map((r) => r.body.status)).toEqual(['SETTLED', 'SETTLED']);
  const charges = await prisma.utilityCharge.findMany();
  expect(charges.reduce((sum, c) => sum + c.prepayApplied, 0)).toBe(1000);
  expect(charges.reduce((sum, c) => sum + c.receivableAmount, 0)).toBe(234);
  expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: f.account!.id } })).balanceCache).toBe(0);
});

it('rolls back balance, ledger, receivable, charge, cursor and request result when final persistence fails, then retries once', async () => {
  const f = await fixture();
  const preview = await f.preview();
  const command = { meterId: f.meter.id, requestId: randomUUID(), reviewToken: preview.body.reviewToken };
  const before = await financial();
  await prisma.$executeRaw`ALTER TABLE utility_posting_confirmations ADD CONSTRAINT injected_posting_failure CHECK (false) NOT VALID`;
  try { expect((await f.send('/utility-charges/confirm', command)).status).toBe(500); }
  finally { await prisma.$executeRaw`ALTER TABLE utility_posting_confirmations DROP CONSTRAINT injected_posting_failure`; }
  expect(await financial()).toEqual(before);
  expect((await f.send('/utility-charges/confirm', command)).body.status).toBe('SETTLED');
  expect(await prisma.utilityCharge.count()).toBe(1);
});

it('blocks unconfirmed rules, missing or inconsistent accounts, unknown ownership and stale previews without moving the cursor', async () => {
  const f = await fixture('PREPAY_WITH_SHORTFALL', -1, false);
  expect((await f.settle()).body).toMatchObject({ status: 'BLOCKED', reasonCode: 'OWNERSHIP_UNRESOLVED' });
  await prisma.meterResponsibilityInterval.create({ data: { meterId: f.meter.id, roomId: f.roomId, contractId: f.contractId, tenantId: f.tenantId, responsibility: 'TENANT', startAt: f.opening.readingTime, openingReadingId: f.opening.id, confirmedBy: f.adminId, evidence: 'explicit fixture responsibility' } });
  expect((await f.settle()).body.reasonCode).toBe('LEGACY_REVIEW_REQUIRED');
  await prisma.utilityPolicyVersion.create({ data: { contractId: f.contractId, feeType: 'ELECTRICITY', version: 1, collectionMode: 'PREPAY_WITH_SHORTFALL', rateCents: '61.7', unit: 'kWh', effectiveFrom: f.opening.readingTime, confirmedBy: f.adminId, evidence: 'explicit fixture policy' } });
  expect((await f.settle()).body.reasonCode).toBe('MISSING_PREPAY_ACCOUNT');
  const account = await prisma.prepayAccount.create({ data: { tenantId: f.tenantId, roomId: f.roomId, balanceCache: 500 } });
  expect((await f.settle()).body.reasonCode).toBe('BALANCE_REVIEW_REQUIRED');
  await prisma.prepayTransaction.create({ data: { accountId: account.id, type: 'RECHARGE', description: 'explicit fixture recharge', amount: 500, balanceAfter: 500, operatorId: f.adminId } });
  const preview = await f.preview();
  await f.send(`/prepay-accounts/${account.id}/transactions`, { type: 'RECHARGE', description: 'explicit fixture recharge', amount: 100 });
  const stale = await f.send('/utility-charges/confirm', { meterId: f.meter.id, requestId: randomUUID(), reviewToken: preview.body.reviewToken });
  expect(stale.body.code).toBe('PREVIEW_STALE');
  expect(await prisma.utilityCharge.count()).toBe(0);
  expect((await prisma.meterReading.findUniqueOrThrow({ where: { id: f.target.id } })).settledAt).toBeNull();
  await prisma.contract.update({ where: { id: f.contractId }, data: { status: 'TERMINATED' } });
  expect((await f.settle()).body.reasonCode).toBe('OWNERSHIP_UNRESOLVED');
});

it('uses confirmed decimal policy segments and rounds their exact sum once, requiring a real rate boundary', async () => {
  const f = await fixture('POSTPAID', -1);
  const at = new Date('2026-06-01T12:00:00Z');
  await prisma.utilityPolicyVersion.create({ data: { contractId: f.contractId, feeType: 'ELECTRICITY', version: 2, collectionMode: 'POSTPAID', rateCents: '70.000001', unit: 'kWh', effectiveFrom: at, confirmedBy: f.adminId, evidence: 'reviewed tariff boundary' } });
  expect((await f.settle()).body.reasonCode).toBe('MISSING_RATE_BOUNDARY');
  await prisma.meterReading.create({ data: { meterId: f.meter.id, source: 'MANUAL', currentReading: 105, previousReading: 100, usage: 5, readingTime: at } });
  const posted = await f.settle();
  expect(posted.body).toMatchObject({ status: 'SETTLED', amount: 659, segments: [{ rateCents: '61.7', usage: 5 }, { rateCents: '70.000001', usage: 5 }] });
  expect((await prisma.utilityCharge.findFirstOrThrow()).receivableAmount).toBe(659);
});

it('closes an open responsibility with real final evidence and rejects charges beyond that scope', async () => {
  const f = await fixture('POSTPAID', -1);
  const interval = await prisma.meterResponsibilityInterval.findFirstOrThrow();
  const dto = { ...f.rules, responsibilityIntervalId: interval.id, closingReadingId: f.target.id, evidence: '核验真实退租交接终读数' };
  const preview = await f.send('/utility-readiness/preview', dto);
  expect(preview.body, JSON.stringify(preview.body)).toMatchObject({ ready: true });
  expect((await f.send('/utility-readiness/confirm', { ...dto, requestId: randomUUID(), reviewToken: preview.body.reviewToken })).status).toBe(201);
  expect((await prisma.meterResponsibilityInterval.findUniqueOrThrow({ where: { id: interval.id } })).endAt).toEqual(f.target.readingTime);
  expect((await f.settle()).body.status).toBe('SETTLED');
  const next = await f.send(`/meters/${f.meter.id}/readings`, { currentReading: 120, readingTime: '2026-06-03T01:00:00Z', autoSettle: true });
  expect(next.body.deduction).toMatchObject({ applied: false, reasonCode: 'OWNERSHIP_UNRESOLVED' });
  expect(await prisma.utilityCharge.count()).toBe(1);
});

it('blocks untraced manual/import/public receivables and protects source-derived amounts and administrative routes', async () => {
  const f = await fixture('DIRECT_TO_PROVIDER', 1000);
  const before = await financial();
  const bill = await f.send('/bills', { contractId: f.contractId, billType: 'UTILITY', period: '2026-06', amount: 999, dueDate: '2026-06-10' });
  expect(bill.body.code).toBe('UTILITY_RULE_BLOCKED');
  expect((await f.send(`/prepay-accounts/${f.account!.id}/transactions`, { type: 'DEDUCTION', amount: 100, description: 'untraced water debit', relatedType: 'METER_READING', relatedId: f.target.id })).body.code).toBe('UTILITY_RULE_BLOCKED');
  const publicBill = await f.send('/public-utilities', { buildingId: f.buildingId, meterType: 'ELECTRICITY', period: '2026-06', totalAmount: 100 });
  expect(publicBill.status, JSON.stringify(publicBill.body)).toBe(201);
  expect((await f.send(`/public-utilities/${publicBill.body.id}/generate-bills`)).body.code).toBe('UTILITY_RULE_BLOCKED');
  const lease = await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } });
  const csv = Buffer.from(`contractNumber,billType,period,amount,paidAmount,dueDate,status\n${lease.contractNumber},UTILITY,2026-06,1.00,0,2026-06-10,PENDING`);
  const imported = await http(app).post('/imports/bills/commit').set(auth(f.adminToken)).query({ dryRun: false, buildingId: f.buildingId })
    .attach('file', csv, 'utility.csv');
  expect(imported.status).toBe(201);
  expect(imported.body.errors).toHaveLength(1);
  expect(imported.body.imported).toBe(0);
  const cleanerToken = await login(app, f.cleanerEmail, f.cleanerPassword);
  for (const token of [f.tenantToken, cleanerToken, undefined]) {
    const req = http(app).post('/utility-charges/preview');
    if (token) req.set(auth(token));
    expect((await req.send({ meterId: f.meter.id })).status).toBe(token ? 403 : 401);
  }
  expect(await financial()).toEqual(before);
  const posted = await f.settle();
  expect(posted.body.status).toBe('SETTLED');
  const record = await prisma.utilityCharge.findFirstOrThrow();
  for (const token of [f.tenantToken, cleanerToken, undefined]) {
    const req = http(app).get(`/utility-charges/${record.id}`);
    if (token) req.set(auth(token));
    expect((await req).status).toBe(token ? 403 : 401);
  }
  await expect(prisma.$executeRaw`UPDATE utility_charges SET "totalAmount" = 1 WHERE id = ${record.id}`).rejects.toThrow();
  const { id: _id, ...data } = record;
  await expect(prisma.utilityCharge.create({ data: { ...data, snapshot: data.snapshot as Prisma.InputJsonValue, baselineReadingId: f.target.id, targetReadingId: f.opening.id } })).rejects.toThrow();
  await expect(prisma.utilityCharge.create({ data: { ...data, snapshot: data.snapshot as Prisma.InputJsonValue, totalAmount: 1, meterId: f.meter.id } })).rejects.toThrow();
});


it.each(['inspection', 'checkout'])('serializes %s ownership evidence against an in-flight formal charge without deadlock', async (action) => {
  const f = await fixture('POSTPAID', -1);
  const inspection = await f.send('/inspections', { contractId: f.contractId, type: 'CHECK_OUT', inspectedAt: f.target.readingTime.toISOString(), inspectorName: 'Concurrent handover' });
  expect(inspection.status).toBe(201);
  const confirmInspection = () => http(app).post(`/inspections/${inspection.body.id}/confirm`).set(auth(f.tenantToken)).send({ agree: true });
  let checkoutId = '';
  if (action === 'checkout') {
    expect((await confirmInspection()).status).toBe(201);
    await prisma.depositLedger.create({ data: { contractId: f.contractId, tenantId: f.tenantId, roomId: f.roomId, amount: 0, balance: 0 } });
    const checkout = await f.send('/checkout', { contractId: f.contractId, roomId: f.roomId, checkoutDate: '2026-06-02', totalRefund: 0, processedBy: f.adminId, inspectionId: inspection.body.id, items: [{ itemType: 'OTHER_FEE', description: 'Zero settlement fixture', amount: 0 }] });
    expect(checkout.status).toBe(201); checkoutId = checkout.body.id;
  }
  const billing = app.get(MeterBillingService);
  const apply = billing.applyReadingDeduction.bind(billing);
  let entered!: () => void; let release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pause = vi.spyOn(billing, 'applyReadingDeduction').mockImplementationOnce(async (...args) => { entered(); await gate; return apply(...args); });
  const first = Promise.resolve(f.settle());
  let second: Promise<Awaited<ReturnType<typeof confirmInspection>>> | undefined;
  try {
    await Promise.race([ready, first.then((r) => { throw new Error(`Posting did not reach the locked core: ${r.status}`); })]);
    second = Promise.resolve(action === 'inspection' ? confirmInspection() : http(app).patch(`/checkout/${checkoutId}`).set(auth(f.adminToken)).send({ status: 'COMPLETED' }));
    let waiting = false;
    const deadline = Date.now() + 3000;
    while (!waiting && Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%FROM rooms%FOR UPDATE%'
          AND cardinality(pg_blocking_pids(pid)) > 0
      ) AS waiting`;
      waiting = rows[0].waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true); release();
    const [charged, handover] = await Promise.all([first, second]);
    expect(charged.body).toMatchObject({ status: 'SETTLED', amount: 617 });
    expect(handover.status).toBe(action === 'inspection' ? 201 : 200);
    expect(await prisma.utilityCharge.count()).toBe(1);
    const next = await f.send(`/meters/${f.meter.id}/readings`, { currentReading: 111, readingTime: '2026-06-03T01:00:00Z', autoSettle: true });
    expect(next.body.deduction).toMatchObject({ applied: false, reasonCode: 'OWNERSHIP_UNRESOLVED' });
    expect((await prisma.meterReading.findUniqueOrThrow({ where: { id: f.target.id } })).settledAmount).toBe(617);
    expect(await prisma.utilityCharge.count()).toBe(1);
  } finally { release(); await Promise.allSettled(second ? [first, second] : [first]); pause.mockRestore(); }
});


it('refuses to shorten confirmed responsibility across an already posted charge', async () => {
  const f = await fixture('POSTPAID', -1);
  expect((await f.settle()).body.status).toBe('SETTLED');
  const inside = await prisma.meterReading.create({ data: { meterId: f.meter.id, source: 'MANUAL', currentReading: 105, previousReading: 100, usage: 5, readingTime: new Date('2026-06-01T12:00:00Z') } });
  const interval = await prisma.meterResponsibilityInterval.findFirstOrThrow();
  const dto = { ...f.rules, responsibilityIntervalId: interval.id, closingReadingId: inside.id };
  const preview = await f.send('/utility-readiness/preview', dto);
  expect(preview.body.ready).toBe(false);
  expect(preview.body.blockingIssues).toContainEqual(expect.objectContaining({ code: 'CLOSE_COVERAGE_CONFLICT' }));
  const before = await financial();
  expect((await f.send('/utility-readiness/confirm', { ...dto, requestId: randomUUID(), reviewToken: preview.body.reviewToken })).body.code).toBe('UTILITY_RULE_BLOCKED');
  expect((await prisma.meterResponsibilityInterval.findUniqueOrThrow({ where: { id: interval.id } })).endAt).toBeNull();
  expect(await financial()).toEqual(before);
});
