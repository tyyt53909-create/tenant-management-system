import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase, setupTenancy } from './harness.js';

let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
beforeEach(async () => { await resetDatabase(); });
afterAll(async () => { await app?.close(); });

it('reports legacy rules as requiring review without inferring consent from an account', async () => {
  const base = await seedBase();
  const tenancy = await setupTenancy(app, base);
  await prisma.meter.create({ data: {
    buildingId: base.buildingId, roomId: tenancy.roomId, meterNumber: 'RULES-01',
    meterType: 'WATER', unitPrice: 200, priceEffectiveDate: app.get(BusinessClock).todayUtc(),
  } });
  await prisma.prepayAccount.create({ data: { tenantId: tenancy.tenantId, roomId: tenancy.roomId } });
  const before = await financialSnapshot();
  const result = await http(app).get(`/utility-readiness/contracts/${tenancy.contractId}`).set(auth(tenancy.adminToken));
  expect(result.status).toBe(200);
  expect(result.body.meters[0].issues.map((issue: { code: string }) => issue.code)).toContain('LEGACY_REVIEW_REQUIRED');
  expect(await financialSnapshot()).toEqual(before);
});

async function financialSnapshot() {
  return {
    bills: await prisma.bill.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.paymentRecord.findMany({ orderBy: { id: 'asc' } }),
    accounts: await prisma.prepayAccount.findMany({ orderBy: { id: 'asc' } }),
    transactions: await prisma.prepayTransaction.findMany({ orderBy: { id: 'asc' } }),
    readings: await prisma.meterReading.findMany({ orderBy: { id: 'asc' } }),
    rooms: await prisma.room.findMany({ orderBy: { id: 'asc' } }),
    contracts: await prisma.contract.findMany({ orderBy: { id: 'asc' } }),
    deposits: await prisma.depositLedger.findMany({ orderBy: { id: 'asc' } }),
    depositTransactions: await prisma.depositTransaction.findMany({ orderBy: { id: 'asc' } }),
  };
}

async function fixture() {
  const base = await seedBase();
  const tenancy = await setupTenancy(app, base, { startDate: '2026-01-01' });
  const meter = await prisma.meter.create({ data: {
    buildingId: base.buildingId, roomId: tenancy.roomId, meterNumber: 'RULES-01',
    meterType: 'ELECTRICITY', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01'),
  } });
  const clock = app.get(BusinessClock);
  async function reading(value: number, secondsAgo: number, source: 'MANUAL' | 'SIMULATED' = 'MANUAL') {
    return prisma.meterReading.create({ data: {
      meterId: meter.id, source, currentReading: value, previousReading: 100, usage: value - 100,
      readingTime: new Date(clock.now().getTime() - secondsAgo * 1000),
    } });
  }
  const opening = await reading(100, 120);
  const closing = await reading(110, 60);
  const dto = {
    meterId: meter.id, contractId: tenancy.contractId, responsibility: 'TENANT',
    openingReadingId: opening.id, closingReadingId: closing.id,
    collectionMode: 'POSTPAID', rateCents: '61.7', evidence: '隔离测试，核对租约收费约定及双方交接记录',
  };
  const preview = (data = dto) => http(app).post('/utility-readiness/preview').set(auth(tenancy.adminToken)).send(data);
  const confirm = (data: object) => http(app).post('/utility-readiness/confirm').set(auth(tenancy.adminToken)).send(data);
  return { ...tenancy, base, meter, opening, closing, dto, preview, confirm, reading };
}

it.each(['PREPAY_WITH_SHORTFALL', 'POSTPAID', 'DIRECT_TO_PROVIDER'])('previews %s and confirms evidence once with no financial writes', async (mode) => {
  const f = await fixture();
  if (mode === 'PREPAY_WITH_SHORTFALL') {
    const account = await http(app).post('/prepay-accounts').set(auth(f.adminToken)).send({ tenantId: f.tenantId, roomId: f.roomId });
    expect(account.status).toBe(201);
    expect((await http(app).post(`/prepay-accounts/${account.body.id}/transactions`).set(auth(f.adminToken))
      .send({ type: 'RECHARGE', amount: 100, description: '核验测试充值' })).status).toBe(201);
  }
  const before = await financialSnapshot();
  const data = { ...f.dto, collectionMode: mode };
  const preview = await f.preview(data);
  expect(preview.status, JSON.stringify(preview.body)).toBe(201);
  expect(preview.body).toMatchObject({ ready: true, billingIssues: [], financialPostingEnabled: true, financialPreview: {
    usage: '10', rateCents: '61.7', totalAmount: 617, financialEffect: 'NONE',
    prepayApplied: mode === 'PREPAY_WITH_SHORTFALL' ? 100 : 0,
    receivableAmount: mode === 'DIRECT_TO_PROVIDER' ? 0 : mode === 'PREPAY_WITH_SHORTFALL' ? 517 : 617,
    providerAmount: mode === 'DIRECT_TO_PROVIDER' ? 617 : 0,
  } });
  expect(await financialSnapshot()).toEqual(before);
  const command = { ...data, requestId: randomUUID(), reviewToken: preview.body.reviewToken };
  const [first, replay] = await Promise.all([f.confirm(command), f.confirm(command)]);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect(await prisma.utilityPolicyVersion.count()).toBe(1);
  expect(await prisma.meterResponsibilityInterval.count()).toBe(1);
  expect(await prisma.utilityRuleConfirmation.count()).toBe(1);
  expect(await prisma.auditLog.count({ where: { action: 'CONFIRM_UTILITY_RULE' } })).toBe(1);
  expect(await prisma.utilityPolicyVersion.findFirst()).toMatchObject({
    collectionMode: mode, confirmedBy: f.base.adminId, contractId: f.contractId, version: 1,
  });
  expect(await prisma.meterResponsibilityInterval.findFirst()).toMatchObject({
    contractId: f.contractId, tenantId: f.tenantId, roomId: f.roomId, meterId: f.meter.id,
    openingReadingId: f.opening.id, closingReadingId: f.closing.id,
  });
  expect(await financialSnapshot()).toEqual(before);
  await app.close();
  app = await createApp();
  expect((await f.confirm(command)).body).toEqual(first.body);
  expect((await f.confirm({ ...command, rateCents: '62' })).status).toBe(409);
  expect(await financialSnapshot()).toEqual(before);
});

it('keeps missing-account prepay blocked while allowing postpaid and provider rule review', async () => {
  const f = await fixture();
  const prepay = await f.preview({ ...f.dto, collectionMode: 'PREPAY_WITH_SHORTFALL' });
  expect(prepay.body).toMatchObject({ ready: true, billingIssues: [{ code: 'PREPAY_ACCOUNT_MISSING' }], financialPreview: { prepayApplied: null, receivableAmount: null } });
  expect((await f.preview()).body.billingIssues).toEqual([]);
  expect((await f.preview({ ...f.dto, collectionMode: 'DIRECT_TO_PROVIDER' })).body.billingIssues).toEqual([]);
  expect(await prisma.prepayAccount.count()).toBe(0);
  await prisma.prepayAccount.create({ data: { tenantId: f.tenantId, roomId: f.roomId, balanceCache: 100 } });
  expect((await f.preview({ ...f.dto, collectionMode: 'PREPAY_WITH_SHORTFALL' })).body.billingIssues)
    .toMatchObject([{ code: 'BALANCE_REVIEW_REQUIRED' }]);
});

it('applies a confirmed provider rule through legacy settlement without landlord receivables', async () => {
  const f = await fixture();
  const preview = await f.preview({ ...f.dto, collectionMode: 'DIRECT_TO_PROVIDER' });
  expect((await f.confirm({ ...f.dto, collectionMode: 'DIRECT_TO_PROVIDER', requestId: randomUUID(), reviewToken: preview.body.reviewToken })).status).toBe(201);
  const before = await financialSnapshot();
  const settled = await http(app).post(`/meters/${f.meter.id}/settle`).set(auth(f.adminToken)).send({});
  expect(settled.body).toMatchObject({ status: 'SETTLED', amount: 617, providerAmount: 617, receivableAmount: 0, prepayApplied: 0 });
  const after = await financialSnapshot();
  expect({ ...after, readings: before.readings }).toEqual(before);
  expect(await prisma.utilityCharge.count()).toBe(1);
  const batch = await http(app).post('/meters/settle-batch').set(auth(f.adminToken)).send({ meterIds: [f.meter.id] });
  expect(batch.body.results).toMatchObject([{ status: 'NO_CHANGE', reasonCode: 'ALREADY_SETTLED' }]);
  const captured = await http(app).post(`/meters/${f.meter.id}/readings`).set(auth(f.adminToken))
    .send({ currentReading: 111, readingTime: app.get(BusinessClock).now().toISOString(), autoSettle: true });
  expect(captured.body.deduction).toMatchObject({ applied: false, reasonCode: 'OWNERSHIP_UNRESOLVED' });
  expect((await prisma.meterReading.findUniqueOrThrow({ where: { id: captured.body.reading.id } })).settledAt).toBeNull();
});

it('invalidates review when a handover confirmation changes while ownership still resolves to the same tenant', async () => {
  const f = await fixture();
  const inspection = await prisma.roomInspection.create({ data: {
    contractId: f.contractId, roomId: f.roomId, tenantId: f.tenantId,
    type: 'CHECK_IN', status: 'CONFIRMED', inspectedAt: f.opening.readingTime,
    tenantConfirmedAt: f.opening.readingTime, inspectorName: '交接核验', createdBy: f.base.adminId,
  } });
  const first = await f.preview();
  expect(first.body.ready).toBe(true);
  await prisma.roomInspection.update({ where: { id: inspection.id }, data: { tenantConfirmedAt: app.get(BusinessClock).now() } });
  const stale = await f.confirm({ ...f.dto, requestId: randomUUID(), reviewToken: first.body.reviewToken });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('PREVIEW_STALE');
  expect(await prisma.utilityRuleConfirmation.count()).toBe(0);
});

it('rejects changed sources and rolls back policy, responsibility, audit and replay result on failure', async () => {
  const f = await fixture();
  const preview = await f.preview();
  await prisma.meter.update({ where: { id: f.meter.id }, data: { unitPrice: 200 } });
  const stale = await f.confirm({ ...f.dto, requestId: randomUUID(), reviewToken: preview.body.reviewToken });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('PREVIEW_STALE');
  const next = await f.preview();
  const command = { ...f.dto, requestId: randomUUID(), reviewToken: next.body.reviewToken };
  const before = await financialSnapshot();
  await prisma.$executeRaw`ALTER TABLE utility_rule_confirmations ADD CONSTRAINT utility_rule_injected_failure CHECK (false) NOT VALID`;
  try { expect((await f.confirm(command)).status).toBe(500); }
  finally { await prisma.$executeRaw`ALTER TABLE utility_rule_confirmations DROP CONSTRAINT utility_rule_injected_failure`; }
  expect(await prisma.utilityPolicyVersion.count()).toBe(0);
  expect(await prisma.meterResponsibilityInterval.count()).toBe(0);
  expect(await prisma.utilityRuleConfirmation.count()).toBe(0);
  expect(await prisma.auditLog.count({ where: { action: 'CONFIRM_UTILITY_RULE' } })).toBe(0);
  expect(await financialSnapshot()).toEqual(before);
  expect((await f.confirm(command)).status).toBe(201);
});

it('serializes overlapping confirmations, enforces the PostgreSQL exclusion constraint and preserves earlier rule versions', async () => {
  const f = await fixture();
  const preview = await f.preview();
  const commands = [0, 1].map(() => ({ ...f.dto, requestId: randomUUID(), reviewToken: preview.body.reviewToken }));
  const results = await Promise.all(commands.map(f.confirm));
  expect(results.map((res) => res.status).sort((a, b) => a - b)).toEqual([201, 409]);
  const existing = await prisma.meterResponsibilityInterval.findFirstOrThrow();
  const { id: _id, ...duplicate } = existing;
  await expect(prisma.meterResponsibilityInterval.create({ data: duplicate })).rejects.toThrow();
  // Different endpoint IDs and a later opening still overlap the first segment.
  const inside = await f.reading(105, 90);
  await expect(prisma.meterResponsibilityInterval.create({ data: { ...duplicate, openingReadingId: inside.id, startAt: inside.readingTime } })).rejects.toThrow(/exclusion|23P01/);
  const later = await f.reading(115, 10);
  const next = { ...f.dto, openingReadingId: f.closing.id, closingReadingId: later.id, rateCents: '70.000001' };
  const nextPreview = await f.preview(next);
  expect(nextPreview.body.ready).toBe(true);
  expect(nextPreview.body.financialPreview.totalAmount).toBe(350);
  expect((await f.confirm({ ...next, requestId: randomUUID(), reviewToken: nextPreview.body.reviewToken })).status).toBe(201);
  const policies = await prisma.utilityPolicyVersion.findMany({ orderBy: { version: 'asc' } });
  expect(policies.map((p) => [p.version, p.rateCents.toString()])).toEqual([[1, '61.7'], [2, '70.000001']]);
  expect(await prisma.meterResponsibilityInterval.count()).toBe(2);
});

it('rejects simulated, future, decreasing, mismatched and unsupported inputs and enforces administrative access', async () => {
  const f = await fixture();
  const sim = await f.reading(150, 10, 'SIMULATED');
  const future = await f.reading(160, -3600);
  for (const row of [sim, future]) {
    const preview = await f.preview({ ...f.dto, closingReadingId: row.id });
    expect(preview.body).toMatchObject({ ready: false, blockingIssues: [{ code: 'MISSING_BASELINE' }] });
    expect((await f.confirm({ ...f.dto, closingReadingId: row.id, requestId: randomUUID(), reviewToken: preview.body.reviewToken })).status).toBe(409);
  }
  expect((await f.preview({ ...f.dto, contractId: 'other-contract' })).body.ready).toBe(false);
  const back = await f.reading(105, 20);
  expect((await f.preview({ ...f.dto, closingReadingId: back.id })).body.blockingIssues.map((i: { code: string }) => i.code)).toContain('HANDOFF_REVIEW_REQUIRED');
  for (const patch of [{ rateCents: '1.1234567' }, { rateCents: 0.617 }, { evidence: '  ' }, { collectionMode: undefined }, { calculationMode: 'TIERED' }]) {
    expect((await f.preview({ ...f.dto, ...patch } as typeof f.dto)).status).toBe(400);
  }
  const cleanerToken = await login(app, f.base.cleanerEmail, f.base.cleanerPassword);
  for (const token of [f.tenantToken, cleanerToken]) {
    expect((await http(app).get(`/utility-readiness/contracts/${f.contractId}`).set(auth(token))).status).toBe(403);
    expect((await http(app).get('/utility-readiness/inventory').set(auth(token))).status).toBe(403);
    expect((await http(app).post('/utility-readiness/preview').set(auth(token)).send(f.dto)).status).toBe(403);
    expect((await http(app).post('/utility-readiness/confirm').set(auth(token)).send(f.dto)).status).toBe(403);
  }
  expect((await http(app).get('/utility-readiness/inventory')).status).toBe(401);
});

it('records an explicit owner interval with no tenant or charges and inventories unknown contracts read-only', async () => {
  const f = await fixture();
  await prisma.contract.update({ where: { id: f.contractId }, data: { startDate: new Date('2026-01-03') } });
  await prisma.meterReading.update({ where: { id: f.opening.id }, data: { readingTime: new Date('2026-01-01T08:00:00Z') } });
  await prisma.meterReading.update({ where: { id: f.closing.id }, data: { readingTime: new Date('2026-01-02T08:00:00Z') } });
  const dto = { meterId: f.meter.id, responsibility: 'OWNER', openingReadingId: f.opening.id, closingReadingId: f.closing.id, evidence: '房东核对空置交接底数' };
  const before = await financialSnapshot();
  const result = await http(app).post('/utility-readiness/preview').set(auth(f.adminToken)).send(dto);
  expect(result.body).toMatchObject({ ready: true, financialPreview: { usage: '10', totalAmount: 0 } });
  expect((await f.confirm({ ...dto, requestId: randomUUID(), reviewToken: result.body.reviewToken })).status).toBe(201);
  expect(await prisma.meterResponsibilityInterval.findFirst()).toMatchObject({ responsibility: 'OWNER', tenantId: null, contractId: null });
  expect(await prisma.utilityPolicyVersion.count()).toBe(0);
  const inventory = await http(app).get('/utility-readiness/inventory').set(auth(f.adminToken));
  expect(inventory.body.items).toMatchObject([{ contractId: f.contractId, unresolvedMeterIds: [f.meter.id] }]);
  expect(await financialSnapshot()).toEqual(before);
});

it('assigns old usage, vacancy and new usage to distinct evidenced intervals and blocks missing handover', async () => {
  const f = await fixture();
  const oldExit = new Date('2026-04-10T02:00:00Z');
  const newEntry = new Date('2026-04-12T02:00:00Z');
  await prisma.contract.update({ where: { id: f.contractId }, data: { status: 'TERMINATED', endDate: new Date('2026-04-10') } });
  const tenant = await prisma.tenant.create({ data: { name: '新租客', phone: '13911119999' } });
  const lease = await prisma.contract.create({ data: {
    roomId: f.roomId, buildingId: f.base.buildingId, tenantId: tenant.id, contractNumber: 'NEW-LEASE',
    status: 'ACTIVE', startDate: new Date('2026-04-12'), endDate: new Date('2026-12-31'),
    rentAmount: 10000, depositAmount: 0, paymentCycle: 'MONTHLY', paymentDay: 1, lateFeeRule: {},
  } });
  const baseline = await prisma.meterReading.update({ where: { id: f.opening.id }, data: { readingTime: new Date('2026-04-09T02:00:00Z'), currentReading: 120 } });
  const oldFinal = await prisma.meterReading.update({ where: { id: f.closing.id }, data: { readingTime: oldExit, currentReading: 125 } });
  const newOpening = await prisma.meterReading.create({ data: { meterId: f.meter.id, source: 'MANUAL', readingTime: newEntry, currentReading: 127, previousReading: 125, usage: 2 } });
  const newFinal = await prisma.meterReading.create({ data: { meterId: f.meter.id, source: 'MANUAL', readingTime: new Date('2026-04-13T02:00:00Z'), currentReading: 137, previousReading: 127, usage: 10 } });
  const old = { ...f.dto, openingReadingId: baseline.id, closingReadingId: oldFinal.id };
  expect((await f.preview(old)).body.ready).toBe(false);
  await prisma.roomInspection.create({ data: {
    type: 'CHECK_OUT', status: 'CONFIRMED', contractId: f.contractId, roomId: f.roomId, tenantId: f.tenantId,
    inspectorName: '交接测试', inspectedAt: oldExit, tenantConfirmedAt: oldExit, createdBy: f.base.adminId,
  } });
  await prisma.roomInspection.create({ data: {
    type: 'CHECK_IN', status: 'CONFIRMED', contractId: lease.id, roomId: f.roomId, tenantId: tenant.id,
    inspectorName: '交接测试', inspectedAt: newEntry, tenantConfirmedAt: newEntry, createdBy: f.base.adminId,
  } });
  const incoming = { ...f.dto, contractId: lease.id, openingReadingId: newOpening.id, closingReadingId: newFinal.id };
  const vacancy = { meterId: f.meter.id, responsibility: 'OWNER', openingReadingId: oldFinal.id, closingReadingId: newOpening.id, evidence: '核对旧退租与新入住之间空置期底数' };
  const before = await financialSnapshot();
  for (const [dto, expectedUsage] of [[old, '5'], [vacancy, '2'], [incoming, '10']] as const) {
    const preview = await http(app).post('/utility-readiness/preview').set(auth(f.adminToken)).send(dto);
    expect(preview.body, JSON.stringify(preview.body.blockingIssues)).toMatchObject({ ready: true, financialPreview: { usage: expectedUsage } });
    expect((await f.confirm({ ...dto, requestId: randomUUID(), reviewToken: preview.body.reviewToken })).status).toBe(201);
  }
  const intervals = await prisma.meterResponsibilityInterval.findMany({ orderBy: { startAt: 'asc' } });
  expect(intervals.map((row) => [row.responsibility, row.contractId, row.tenantId])).toEqual([
    ['TENANT', f.contractId, f.tenantId], ['OWNER', null, null], ['TENANT', lease.id, tenant.id],
  ]);
  expect(await financialSnapshot()).toEqual(before);
});
