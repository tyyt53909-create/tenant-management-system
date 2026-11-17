import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { SimulationScenario } from '../../src/modules/meters/dto/run-simulation.dto.js';
import { MetersSimulatorService } from '../../src/modules/meters/meters-simulator.service.js';
import { MetersService } from '../../src/modules/meters/meters.service.js';
import { MeterBillingService } from '../../src/modules/meters/meter-billing.service.js';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth, type SeedBase } from './harness.js';

/** FIN-08 / T274：抄表去重、生效单价与结算幂等（真实 DB） */
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

async function createMeter(
  adminToken: string,
  buildingId: string,
  roomId: string,
  unitPrice: number,
  initialReading = 0,
) {
  const response = await http(app)
    .post('/meters')
    .set(auth(adminToken))
    .send({
      buildingId,
      roomId,
      meterType: 'ELECTRICITY',
      meterNumber: `IT-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      unitPrice,
      priceEffectiveDate: '2026-01-01',
      initialReading,
    });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function preparePrepay(adminToken: string, tenantId: string, roomId: string, amount = 100000) {
  const account = await http(app)
    .post('/prepay-accounts')
    .set(auth(adminToken))
    .send({ tenantId, roomId });
  expect(account.status).toBe(201);

  const recharge = await http(app)
    .post(`/prepay-accounts/${account.body.id}/transactions`)
    .set(auth(adminToken))
    .send({ type: 'RECHARGE', amount, description: '集成测试充值' });
  expect(recharge.status).toBe(201);
  return account.body.id as string;
}

function readingBody(currentReading: number, readingTime: string, extra: Record<string, unknown> = {}) {
  return { currentReading, readingTime, ...extra };
}

function setupMeterTenancy(base: SeedBase) {
  // Historical reads in these fixtures must start inside the recorded lease.
  return setupTenancy(app, base, { startDate: '2026-01-01' });
}

describe('抄表与计价（FIN-08）', () => {
  it('未来及模拟读数不进入底数、真实结算和统计，旧模拟幂等键不阻塞真实上报', async () => {
    const base = await seedBase();
    const { adminToken, tenantId, roomId, contractId } = await setupMeterTenancy(base);
    const account = await preparePrepay(adminToken, tenantId, roomId, 300);
    const created = await http(app).post('/meters').set(auth(adminToken)).send({
      buildingId: base.buildingId, roomId, meterType: 'ELECTRICITY', meterNumber: 'IT-ISOLATION',
      unitPrice: 100, priceEffectiveDate: '2026-01-01',
    });
    expect(created.status).toBe(201);
    const meterId = created.body.id as string;
    const now = Date.UTC(2026, 3, 14, 12);
    const timeAt = (delta: number) => new Date(now + delta).toISOString();
    const initialTime = timeAt(-120_000);
    const firstRealTime = timeAt(-90_000);
    const secondRealTime = timeAt(-60_000);
    const futureTime = new Date(Date.now() + 86_400_000).toISOString();
    const reading = (value: number, time: string, extra: Record<string, unknown> = {}) =>
      http(app).post(`/meters/${meterId}/readings`).set(auth(adminToken)).send(readingBody(value, time, extra));

    const legacySim = await prisma.meterReading.create({ data: {
      meterId, source: 'SIMULATED', currentReading: 900, previousReading: 0, usage: 900,
      readingTime: new Date(timeAt(-100_000)), settledAt: new Date(timeAt(-100_000)), dedupKey: 'msg:shared-id',
    } });
    const legacyAnomaly = await prisma.meterReading.create({ data: {
      meterId, source: 'DEVICE', currentReading: 2000, previousReading: 900, usage: 1100,
      readingTime: new Date(timeAt(-70_000)), notes: '[ANOMALY] 旧模拟器伪设备',
    } });
    // 这条旧记录现在已在过去，但在写入时是未来读数。
    const legacyFuture = await prisma.meterReading.create({ data: {
      meterId, source: 'DEVICE', currentReading: 3000, previousReading: 100, usage: 2900,
      readingTime: new Date(timeAt(-40_000)), createdAt: new Date(timeAt(-70_000)),
      settledAt: new Date(timeAt(-70_000)),
    } });

    const currentFuture = await prisma.meterReading.create({ data: {
      meterId, source: 'MANUAL', currentReading: 3500, previousReading: 3000, usage: 500,
      readingTime: new Date(futureTime), createdAt: new Date(futureTime), settledAt: new Date(futureTime),
    } });

    const service = app.get(MetersService);
    const simulated = await service.createReading(meterId, {
      source: 'SIMULATED', currentReading: 1200, readingTime: futureTime, autoSettle: true,
      messageId: 'shared-id',
    }, 'integration-admin');
    expect(simulated.reading).toMatchObject({ source: 'SIMULATED', settledAt: null, settledAmount: null });
    const simulatedNext = await service.createReading(meterId, {
      source: 'SIMULATED', currentReading: 1300, readingTime: new Date(Date.parse(futureTime) + 60_000).toISOString(), autoSettle: true,
    }, 'integration-admin');
    expect(simulatedNext.deduction).toMatchObject({ applied: false });
    expect(simulatedNext.reading.settledAt).toBeNull();
    const anomalyReport = await app.get(MetersSimulatorService).runSimulation({
      scenario: SimulationScenario.ANOMALY_TEST, meterId, autoSettle: true,
    }, 'integration-admin');
    expect(anomalyReport).toMatchObject({ success: true, anomalyResults: { passedCount: 4 } });
    expect(await prisma.meterReading.count({
      where: { meterId, source: 'DEVICE', notes: { contains: '[ANOMALY]' } },
    })).toBe(1);
    expect(await prisma.prepayAccount.findUniqueOrThrow({ where: { id: account } }))
      .toMatchObject({ balanceCache: 300 });
    expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(0);

    const initial = await reading(100, initialTime, { source: 'DEVICE', isInitial: true, messageId: 'shared-id' });
    expect(initial.status).toBe(201);
    expect(initial.body.reading).toMatchObject({ source: 'DEVICE', currentReading: '100' });
    expect(initial.body.reading.id).not.toBe(legacySim.id);
    const replay = await reading(100, initialTime, { source: 'DEVICE', isInitial: true, messageId: 'shared-id' });
    expect(replay.body.reading.id).toBe(initial.body.reading.id);

    const rejected = await reading(4000, futureTime, { autoSettle: true, isInitial: true });
    expect(rejected.status).toBe(400);
    expect(rejected.body.details).toMatchObject({ reasonCode: 'FUTURE_READING' });
    const mixed = await http(app).post('/meters/batch-readings').set(auth(adminToken)).send({ readings: [
      { meterId, currentReading: 4000, readingTime: futureTime, autoSettle: true },
      { meterId, currentReading: 110, readingTime: firstRealTime, autoSettle: false },
    ] });
    expect(mixed.status).toBe(201);
    expect(mixed.body).toMatchObject({ successCount: 1, failureCount: 1, results: [
      { success: false, reasonCode: 'FUTURE_READING' }, { success: true, previousReading: 100, usage: 10 },
    ] });
    expect(await prisma.meterReading.count({ where: { meterId, currentReading: 4000 } })).toBe(0);

    const settled = await http(app).post('/meters/settle-batch').set(auth(adminToken))
      .send({ meterIds: [meterId], settleUntil: futureTime });
    expect(settled.status).toBe(201);
    expect(settled.body).toMatchObject({ settledCount: 1, results: [
      { contractId, status: 'SETTLED', baselineReading: 100, currentReading: 110, usage: 10, amount: 1000 },
    ] });
    expect(new Date(settled.body.settleUntil).getTime()).toBeLessThan(Date.parse(futureTime));

    const updated = await reading(115, secondRealTime, { autoSettle: true });
    expect(updated.status).toBe(201);
    expect(updated.body).toMatchObject({
      reading: { previousReading: '110', usage: '5' },
      deduction: { applied: true, amount: 500, shortfall: 500 },
    });
    expect(await prisma.prepayAccount.findUniqueOrThrow({ where: { id: account } }))
      .toMatchObject({ balanceCache: 0 });
    expect(await prisma.prepayTransaction.findMany({ where: { accountId: account, type: 'DEDUCTION' } }))
      .toMatchObject([{ amount: -300 }]);
    const bills = await prisma.bill.findMany({ where: { billType: 'UTILITY' }, orderBy: { amount: 'asc' } });
    expect(bills).toMatchObject([{ contractId, amount: 500 }, { contractId, amount: 700 }]);

    const sheet = await http(app).get('/meters/batch-sheet').set(auth(adminToken));
    expect(sheet.status).toBe(200);
    expect(sheet.body).toEqual(expect.arrayContaining([expect.objectContaining({ meterId, lastReading: 115 })]));
    const history = await http(app).get(`/meters/${meterId}/readings`).set(auth(adminToken));
    expect(history.status).toBe(200);
    expect(history.body.meta.total).toBe(3);
    expect(history.body.data.map((row: { currentReading: string }) => row.currentReading)).toEqual(['115', '110', '100']);

    const overview = await http(app).get('/meters/usage-overview').set(auth(adminToken))
      .query({ month: secondRealTime.slice(0, 7), buildingId: base.buildingId });
    expect(overview.status).toBe(200);
    expect(overview.body.electricity).toMatchObject({ usage: 15, count: 3 });
    const clock = vi.spyOn(app.get(BusinessClock), 'now').mockReturnValue(new Date(secondRealTime));
    try {
      const summary = await http(app).get('/dashboard/management-summary').set(auth(adminToken));
      expect(summary.status).toBe(200);
      expect(summary.body.meters).toMatchObject({ electricity: 15, read: 1 });
    } finally {
      clock.mockRestore();
    }

    const reconciliation = await http(app).get('/meters/reconciliation').set(auth(adminToken))
      .query({ period: secondRealTime.slice(0, 7), buildingId: base.buildingId });
    expect(reconciliation.status).toBe(200);
    expect(reconciliation.body.rows).toEqual([expect.objectContaining({
      meterId, openingReading: 100, closingReading: 115, readingUsage: 15,
      chargedAmount: 300, billAmount: 1200, difference: 0,
    })]);

    const csv = await http(app).get('/meters/readings/export').set(auth(adminToken)).query({ meterId });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(updated.body.reading.id);
    for (const id of [legacySim.id, legacyAnomaly.id, legacyFuture.id, currentFuture.id, simulatedNext.reading.id]) {
      expect(csv.text).not.toContain(id);
    }
  });

  it('退租、空置、入住按实测界点分账；缺交接或跨区间时所有入口都保留待结算', async () => {
    const base = await seedBase();
    const oldTenant = await setupMeterTenancy(base);
    const { adminToken, roomId } = oldTenant;
    const meterId = await createMeter(adminToken, base.buildingId, roomId, 100, 100);
    const oldAccount = await preparePrepay(adminToken, oldTenant.tenantId, roomId, 300);
    const checkoutTime = '2026-04-10T02:00:00.000Z';
    const checkinTime = '2026-04-12T02:00:00.000Z';
    const latestTime = '2026-04-14T02:00:00.000Z';
    const reading = (value: number, time: string, autoSettle: boolean) =>
      http(app).post(`/meters/${meterId}/readings`).set(auth(adminToken)).send(readingBody(value, time, { autoSettle }));
    const settle = (settleUntil: string) =>
      http(app).post(`/meters/${meterId}/settle`).set(auth(adminToken)).send({ settleUntil });
    const batch = (settleUntil: string) =>
      http(app).post('/meters/settle-batch').set(auth(adminToken)).send({ meterIds: [meterId], settleUntil });
    const inspect = async (contractId: string, type: string, inspectedAt: string) => {
      const res = await http(app).post('/inspections').set(auth(adminToken))
        .send({ contractId, type, inspectedAt, inspectorName: '集成测试验房' });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const confirm = async (id: string, tenantToken: string) => {
      const res = await http(app).post(`/inspections/${id}/confirm`).set(auth(tenantToken)).send({ agree: true });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CONFIRMED');
    };

    const finalOldReading = await reading(110, checkoutTime, false);
    expect(finalOldReading.status).toBe(201);
    const checkoutInspection = await inspect(oldTenant.contractId, 'CHECK_OUT', checkoutTime);
    await confirm(checkoutInspection, oldTenant.tenantToken);
    await prisma.depositLedger.create({
      data: { contractId: oldTenant.contractId, tenantId: oldTenant.tenantId, roomId, amount: 300000, balance: 0 },
    });
    const checkout = await http(app).post('/checkout').set(auth(adminToken)).send({
      contractId: oldTenant.contractId, roomId, checkoutDate: '2026-04-10',
      processedBy: 'integration-admin', totalRefund: 0, inspectionId: checkoutInspection,
      items: [{ itemType: 'OTHER_FEE', description: '验房交接', amount: 0 }],
    });
    expect(checkout.status).toBe(201);
    const completed = await http(app).patch(`/checkout/${checkout.body.id}`).set(auth(adminToken))
      .send({ status: 'COMPLETED' });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(await prisma.contract.findUniqueOrThrow({ where: { id: oldTenant.contractId } }))
      .toMatchObject({ status: 'TERMINATED' });

    const releasedRoom = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    expect(releasedRoom.status).toBe('VACANT');
    const cleaning = await http(app).patch(`/rooms/${roomId}/status`).set(auth(adminToken))
      .send({ cleanStatus: 'CLEANING', version: releasedRoom.version });
    expect(cleaning.status).toBe(200);
    const cleaned = await http(app).patch(`/rooms/${roomId}/status`).set(auth(adminToken))
      .send({ cleanStatus: 'CLEAN', version: cleaning.body.version });
    expect(cleaned.status).toBe(200);

    const incoming = await setupTenancy(app, base, { roomId, startDate: '2026-04-12' });
    const newAccount = await preparePrepay(adminToken, incoming.tenantId, roomId);
    const checkin = await inspect(incoming.contractId, 'CHECK_IN', checkinTime);
    const vacancyEnd = await reading(114, checkinTime, false);
    expect(vacancyEnd.status).toBe(201);

    const single = await reading(120, '2026-04-13T02:00:00.000Z', true);
    expect(single.status).toBe(201);
    expect(single.body.deduction).toMatchObject({ applied: false, reasonCode: 'OCCUPANCY_UNCERTAIN' });
    const captured = await http(app).post('/meters/batch-readings').set(auth(adminToken))
      .send({ readings: [{ meterId, currentReading: 124, readingTime: latestTime }] });
    expect(captured.status).toBe(201);
    expect(captured.body.results[0]).toMatchObject({
      success: true, deductionBlocked: { reasonCode: 'OCCUPANCY_UNCERTAIN' },
    });
    const reset = await http(app).post(`/meters/${meterId}/readings`).set(auth(adminToken))
      .send(readingBody(124, latestTime, { isInitial: true, messageId: 'replacement-baseline' }));
    expect(reset.status).toBe(400);

    const blockedBeforeConfirmation = await batch(checkinTime);
    expect(blockedBeforeConfirmation.body).toMatchObject({
      blockedCount: 1, results: [{ status: 'BLOCKED', reasonCode: 'OCCUPANCY_UNCERTAIN' }],
    });
    expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(0);
    expect(await prisma.prepayTransaction.count({ where: { type: 'DEDUCTION' } })).toBe(0);
    expect(await prisma.meterReading.count({ where: { meterId, settledAt: { not: null } } })).toBe(1);

    const oldPreview = await http(app).get(`/meters/${meterId}/unsettled-usage`).set(auth(adminToken))
      .query({ settleUntil: checkoutTime });
    expect(oldPreview.body).toMatchObject({ unsettledUsage: 10, estimatedAmount: 1000, prepayBalance: 300 });
    const tail = await settle(checkoutTime);
    expect(tail.status).toBe(201);
    expect(tail.body).toMatchObject({
      status: 'SETTLED', contractId: oldTenant.contractId, usage: 10, amount: 1000,
    });

    const pendingVacancy = await settle(checkinTime);
    expect(pendingVacancy.body).toMatchObject({
      status: 'BLOCKED', reasonCode: 'OCCUPANCY_UNCERTAIN', usage: 4,
    });
    expect(await prisma.meterReading.findUniqueOrThrow({ where: { id: vacancyEnd.body.reading.id } }))
      .toMatchObject({ settledAt: null });

    await confirm(checkin, incoming.tenantToken);
    const blocked = await batch(latestTime);
    expect(blocked.body).toMatchObject({
      blockedCount: 1, settledCount: 0,
      results: [{ status: 'BLOCKED', reasonCode: 'OCCUPANCY_UNCERTAIN', usage: 14 }],
    });
    const vacancy = await settle(checkinTime);
    expect(vacancy.body).toMatchObject({
      status: 'NO_CHANGE', reasonCode: 'VACANT_INTERVAL', settled: true, usage: 4, amount: 0,
    });
    const next = await settle(latestTime);
    expect(next.body).toMatchObject({
      status: 'SETTLED', contractId: incoming.contractId, usage: 10, amount: 1000,
    });

    const bills = await prisma.bill.findMany({ where: { billType: 'UTILITY' } });
    expect(bills).toMatchObject([{ contractId: oldTenant.contractId, amount: 700, snapshot: {
      readingId: finalOldReading.body.reading.id,
      intervalEnd: checkoutTime,
    } }]);
    const ledger = await prisma.prepayTransaction.findMany({
      where: { type: 'DEDUCTION' }, orderBy: { createdAt: 'asc' },
    });
    expect(ledger).toMatchObject([
      { accountId: oldAccount, amount: -300, relatedId: finalOldReading.body.reading.id },
      { accountId: newAccount, amount: -1000 },
    ]);
    const vacantReading = await prisma.meterReading.findUniqueOrThrow({ where: { id: vacancyEnd.body.reading.id } });
    expect(vacantReading).toMatchObject({ settledAmount: 0, notes: expect.stringContaining('[VACANT_USAGE]') });
    expect(Number(vacantReading.settledUsage)).toBe(4);
    expect((await batch(latestTime)).body).toMatchObject({ settledCount: 0, noChangeCount: 1 });
    expect(await prisma.prepayTransaction.count({ where: { type: 'DEDUCTION' } })).toBe(2);
  });

  it('批量结算区分四类结果；缺账户补办、余额不足和失败重试均可核账', async () => {
    const base = await seedBase();
    const blockedTenancy = await setupMeterTenancy(base);
    const fundedTenancy = await setupMeterTenancy(base);
    const { adminToken } = blockedTenancy;
    const fundedAccount = await preparePrepay(adminToken, fundedTenancy.tenantId, fundedTenancy.roomId);
    const blocked = await createMeter(adminToken, base.buildingId, blockedTenancy.roomId, 100, 100);
    const zero = await createMeter(adminToken, base.buildingId, blockedTenancy.roomId, 100, 100);
    const funded = await createMeter(adminToken, base.buildingId, fundedTenancy.roomId, 100, 100);
    const failing = await createMeter(adminToken, base.buildingId, fundedTenancy.roomId, 100, 100);
    const readingTime = new Date().toISOString();
    const settleUntil = readingTime;

    const record = async (meterId: string, value: number, autoSettle: boolean) => {
      const response = await http(app).post(`/meters/${meterId}/readings`).set(auth(adminToken))
        .send(readingBody(value, readingTime, { autoSettle }));
      expect(response.status).toBe(201);
      return response.body;
    };
    const settle = (meterIds: string[]) => http(app).post('/meters/settle-batch').set(auth(adminToken))
      .send({ meterIds, settleUntil });

    const blockedReading = await record(blocked, 110, true);
    expect(blockedReading.deduction).toMatchObject({ applied: false, reasonCode: 'MISSING_PREPAY_ACCOUNT' });
    await record(zero, 100, false);
    const fundedReading = (await record(funded, 105, false)).reading;
    const failingReading = (await record(failing, 107, false)).reading;

    // 在真实资金写入后模拟结算异常，验证该条事务回滚且批量继续。
    const billing = app.get(MeterBillingService);
    const apply = billing.applyReadingDeduction.bind(billing);
    const failure = vi.spyOn(billing, 'applyReadingDeduction').mockImplementation(async (...args) => {
      const result = await apply(...args);
      if (args[1].id === failing) throw new Error('fixture: settlement interrupted');
      return result;
    });
    let first: Response;
    try {
      first = await settle([blocked, zero, failing, funded]);
    } finally {
      failure.mockRestore();
    }
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      settleUntil, total: 4, settledCount: 1, noChangeCount: 1, blockedCount: 1, failedCount: 1,
      successCount: 1, failureCount: 2,
      results: [
        { meterId: blocked, status: 'BLOCKED', reasonCode: 'MISSING_PREPAY_ACCOUNT', usage: 10, amount: 1000, success: false, settled: false, retryCondition: expect.any(String) },
        { meterId: zero, status: 'NO_CHANGE', reasonCode: 'ZERO_USAGE', success: false },
        { meterId: failing, status: 'FAILED', reasonCode: 'SETTLEMENT_FAILED', success: false },
        { meterId: funded, status: 'SETTLED', usage: 5, amount: 500, success: true, prepayTransactionId: expect.any(String) },
      ],
    });
    for (const id of [blockedReading.reading.id, failingReading.id]) {
      expect(await prisma.meterReading.findUniqueOrThrow({ where: { id } })).toMatchObject({ settledAt: null });
    }
    expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(0);
    expect(await prisma.prepayAccount.findUniqueOrThrow({ where: { id: fundedAccount } }))
      .toMatchObject({ balanceCache: 99500 });
    expect(await prisma.prepayTransaction.findMany({ where: { relatedType: 'METER_READING' } }))
      .toMatchObject([{ amount: -500, relatedId: fundedReading.id }]);

    const account = await http(app).post('/prepay-accounts').set(auth(adminToken))
      .send({ roomId: blockedTenancy.roomId, tenantId: blockedTenancy.tenantId });
    expect(account.status).toBe(201);
    const recharge = await http(app).post(`/prepay-accounts/${account.body.id}/transactions`).set(auth(adminToken))
      .send({ type: 'RECHARGE', amount: 300, description: '集成测试余额不足' });
    expect(recharge.status).toBe(201);

    const retry = await settle([blocked, failing]);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({
      settledCount: 2, blockedCount: 0, failedCount: 0,
      results: [
        { meterId: blocked, status: 'SETTLED', usage: 10, amount: 1000, billId: expect.any(String), prepayTransactionId: expect.any(String) },
        { meterId: failing, status: 'SETTLED', amount: 700 },
      ],
    });
    const replay = await settle([blocked, zero, failing, funded]);
    expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({ total: 4, settledCount: 0, noChangeCount: 4, blockedCount: 0, failedCount: 0 });

    const { billId, prepayTransactionId } = retry.body.results[0];
    expect(await prisma.bill.findMany({ where: { billType: 'UTILITY' } })).toMatchObject([
      { id: billId, contractId: blockedTenancy.contractId, amount: 700 },
    ]);
    expect(await prisma.prepayTransaction.findMany({ where: { accountId: account.body.id, type: 'DEDUCTION' } }))
      .toMatchObject([{ id: prepayTransactionId, amount: -300, balanceAfter: 0, relatedId: blockedReading.reading.id }]);
    expect(await prisma.prepayAccount.findUniqueOrThrow({ where: { id: account.body.id } }))
      .toMatchObject({ balanceCache: 0 });
    const settledReading = await prisma.meterReading.findUniqueOrThrow({ where: { id: blockedReading.reading.id } });
    expect(settledReading).toMatchObject({ settledAt: expect.any(Date), settledAmount: 1000 });
    expect(Number(settledReading.settledUsage)).toBe(10);
  });

  it('回退和正向换表待确认时保留游标，确认两次交接后只计实际分段用量', async () => {
    const base = await seedBase();
    const tenancy = await setupMeterTenancy(base);
    const { adminToken, tenantId, roomId } = tenancy;
    const account = await preparePrepay(adminToken, tenantId, roomId);
    const meterId = await createMeter(adminToken, base.buildingId, roomId, 100, 100);
    const register = (current: number, time: string, extra: Record<string, unknown>) =>
      http(app).post(`/meters/${meterId}/readings`).set(auth(adminToken)).send(readingBody(current, time, extra));
    const settle = () => http(app).post(`/meters/${meterId}/settle`).set(auth(adminToken)).send({});
    const confirm = (id: string, previousFinal: number, newOpening: number) =>
      http(app).post(`/meters/${meterId}/readings/${id}/handoff`).set(auth(adminToken))
        .send({ previousFinal, newOpening });

    const initial = await prisma.meterReading.findFirstOrThrow({ where: { meterId } });
    const rollback = await register(5, '2026-01-20T02:00:00Z', { allowRollover: true, autoSettle: true });
    expect(rollback.status).toBe(201);
    expect(rollback.body.deduction).toMatchObject({ applied: false, reasonCode: 'UNCONFIRMED_HANDOFF' });
    const batch = await http(app).post('/meters/batch-readings').set(auth(adminToken)).send({ readings: [
      { meterId, currentReading: 130, readingTime: '2026-01-21T02:00:00Z', allowRollover: true, autoSettle: true },
      { meterId, currentReading: 132, readingTime: '2026-01-22T02:00:00Z', autoSettle: true },
    ] });
    expect(batch.status).toBe(201);
    for (const result of batch.body.results) {
      expect(result).toMatchObject({ success: true, deductionBlocked: { reasonCode: 'UNCONFIRMED_HANDOFF' } });
    }
    const pending = await settle();
    expect(pending.body).toMatchObject({ status: 'BLOCKED', reasonCode: 'UNCONFIRMED_HANDOFF', settled: false });
    expect(await prisma.meterReading.findMany({ where: { meterId, settledAt: { not: null } }, select: { id: true } }))
      .toEqual([{ id: initial.id }]);

    const firstId = rollback.body.reading.id as string;
    expect((await confirm(firstId, 99, 5)).status).toBe(400);
    expect((await confirm(firstId, 120, 6)).status).toBe(400);
    const denied = await http(app).post(`/meters/${meterId}/readings/${firstId}/handoff`)
      .set(auth(tenancy.tenantToken)).send({ previousFinal: 120, newOpening: 5 });
    expect(denied.status).toBe(403);
    const first = await confirm(firstId, 120, 5);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ handoffPreviousFinal: '120', handoffConfirmedBy: expect.any(String), settledAt: null });
    const backfilled = await register(111, '2026-01-19T02:00:00Z', { autoSettle: true });
    expect(backfilled.status).toBe(201);
    expect(backfilled.body.deduction).toMatchObject({ applied: false });
    expect((await register(121, '2026-01-19T03:00:00Z', {})).status).toBe(400);
    expect((await settle()).body).toMatchObject({ status: 'BLOCKED', reasonCode: 'UNCONFIRMED_HANDOFF' });
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: account } })).balanceCache).toBe(100000);

    const forward = await prisma.meterReading.findFirstOrThrow({ where: { meterId, currentReading: 130 } });
    expect((await confirm(forward.id, 10, 130)).status).toBe(201);
    const settled = await settle();
    expect(settled.status).toBe(201);
    expect(settled.body).toMatchObject({
      status: 'SETTLED', usage: 27, amount: 2700,
      segments: [
        { startReading: 100, endReading: 120, nextOpeningReading: 5, usage: 20 },
        { startReading: 5, endReading: 10, nextOpeningReading: 130, usage: 5 },
        { startReading: 130, endReading: 132, usage: 2 },
      ],
    });
    const terminal = await prisma.meterReading.findFirstOrThrow({ where: { meterId, currentReading: 132 } });
    expect(terminal.settledSegments).toEqual(settled.body.segments);
    expect((await confirm(firstId, 120, 5)).status).toBe(201);
    expect((await confirm(firstId, 121, 5)).status).toBe(400);
    expect((await settle()).body).toMatchObject({ status: 'NO_CHANGE', reasonCode: 'ALREADY_SETTLED' });
    expect(await prisma.prepayTransaction.findMany({ where: { accountId: account, type: 'DEDUCTION' } }))
      .toMatchObject([{ amount: -2700 }]);

    // 存量设备记录可能与已结算底数同一时刻但数值冲突，不能任意择一。
    await prisma.meterReading.create({ data: {
      meterId, source: 'DEVICE', readingTime: terminal.readingTime,
      currentReading: 131, previousReading: 130, usage: 1,
    } });
    const later = await register(134, '2026-01-23T02:00:00Z', { autoSettle: true });
    expect(later.body.deduction).toMatchObject({ applied: false, reasonCode: 'UNCONFIRMED_HANDOFF' });
    expect((await settle()).body).toMatchObject({ status: 'BLOCKED', reasonCode: 'UNCONFIRMED_HANDOFF' });
    expect(await prisma.prepayTransaction.count({ where: { accountId: account, type: 'DEDUCTION' } })).toBe(1);
  });

  it('跨调价缺界点时停止，补录精确界点后对分段金额合计仅舍入一次', async () => {
    const base = await seedBase();
    const tenancy = await setupMeterTenancy(base);
    const { adminToken, tenantId, roomId, contractId } = tenancy;
    const account = await preparePrepay(adminToken, tenantId, roomId, 1);
    const meterId = await createMeter(adminToken, base.buildingId, roomId, 150, 100);
    const register = (current: number, time: string, autoSettle: boolean) =>
      http(app).post(`/meters/${meterId}/readings`).set(auth(adminToken)).send(readingBody(current, time, { autoSettle }));
    const settle = () => http(app).post(`/meters/${meterId}/settle`).set(auth(adminToken)).send({});
    const price = await http(app).post(`/meters/${meterId}/price`).set(auth(adminToken))
      .send({ unitPrice: 250, effectiveDate: '2026-01-20' });
    expect(price.status).toBe(201);

    const target = await register(100.02, '2026-01-25T02:00:00Z', true);
    expect(target.body.deduction).toMatchObject({ applied: false, reasonCode: 'MISSING_RATE_BOUNDARY' });
    const approximate = await register(100.01, '2026-01-19T15:59:59.999Z', false);
    expect(approximate.status).toBe(201);
    const blocked = await settle();
    expect(blocked.body).toMatchObject({ status: 'BLOCKED', reasonCode: 'MISSING_RATE_BOUNDARY', settled: false });
    expect(await prisma.bill.count({ where: { contractId, billType: 'UTILITY' } })).toBe(0);
    expect(await prisma.meterReading.count({ where: { meterId, settledAt: { not: null } } })).toBe(1);

    const exact = await register(100.01, '2026-01-19T16:00:00.000Z', false);
    expect(exact.status).toBe(201);
    const preview = await http(app).get(`/meters/${meterId}/unsettled-usage`).set(auth(adminToken));
    expect(preview.body).toMatchObject({ unsettledUsage: 0.02, estimatedAmount: 4 });
    const settled = await settle();
    expect(settled.status).toBe(201);
    expect(settled.body).toMatchObject({
      status: 'SETTLED', amount: 4, usage: 0.02,
      segments: [
        { endReadingId: exact.body.reading.id, usage: 0.01, unitPrice: 150 },
        { startReadingId: exact.body.reading.id, usage: 0.01, unitPrice: 250 },
      ],
    });
    expect(await prisma.bill.findMany({ where: { contractId, billType: 'UTILITY' } })).toMatchObject([
      { amount: 3, snapshot: { unitPrice: null, totalAmount: 4, segments: settled.body.segments } },
    ]);
    expect(await prisma.prepayTransaction.findMany({ where: { accountId: account, type: 'DEDUCTION' } }))
      .toMatchObject([{ amount: -1 }]);
    const finalReading = await prisma.meterReading.findUniqueOrThrow({ where: { id: target.body.reading.id } });
    expect(finalReading.settledUnitPrice).toBeNull();
    expect(finalReading.settledSegments).toEqual(settled.body.segments);
    const reconciliation = await http(app).get('/meters/reconciliation').set(auth(adminToken))
      .query({ period: '2026-01', buildingId: base.buildingId });
    expect(reconciliation.status).toBe(200);
    expect(reconciliation.body.rows).toEqual([expect.objectContaining({
      meterId, readingUsage: 0.02, readingAmount: 4, difference: 0,
    })]);
    expect((await settle()).body).toMatchObject({ status: 'NO_CHANGE', reasonCode: 'ALREADY_SETTLED' });
  });

  it('调价跨月后按读数业务日的生效价结算，历史读数不被新价重算', async () => {
    const base = await seedBase();
    const tenancy = await setupMeterTenancy(base);
    await preparePrepay(tenancy.adminToken, tenancy.tenantId, tenancy.roomId);
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100);

    // 1 月读数：100 单位 × 100 分 = 10000 分
    const january = await http(app)
      .post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(readingBody(100, '2026-01-15T02:00:00.000Z'));
    expect(january.status).toBe(201);
    expect(january.body.deduction).toMatchObject({ applied: true, amount: 10000 });

    // 2 月起调价到 200 分
    const price = await http(app)
      .post(`/meters/${meterId}/price`)
      .set(auth(tenancy.adminToken))
      .send({ unitPrice: 200, effectiveDate: '2026-02-01' });
    expect(price.status).toBe(201);

    const boundary = await http(app)
      .post(`/meters/${meterId}/readings`).set(auth(tenancy.adminToken))
      .send(readingBody(100, '2026-01-31T16:00:00.000Z', { autoSettle: false }));
    expect(boundary.status).toBe(201);

    // 2 月读数：新增 50 单位 × 200 分 = 10000 分
    const february = await http(app)
      .post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(readingBody(150, '2026-02-15T02:00:00.000Z'));
    expect(february.status).toBe(201);
    expect(february.body.deduction).toMatchObject({ applied: true, amount: 10000 });

    const readings = await prisma.meterReading.findMany({
      where: { meterId },
      orderBy: { readingTime: 'asc' },
    });
    const settled = readings.filter((reading) => reading.settledAt);
    expect(settled.map((reading) => reading.settledUnitPrice)).toEqual([100, 100, 200]);
    expect(settled.map((reading) => reading.settledAmount)).toEqual([0, 10000, 10000]);

    const deductions = await prisma.prepayTransaction.findMany({
      where: { relatedType: 'METER_READING' },
      orderBy: { createdAt: 'asc' },
    });
    expect(deductions.map((transaction) => transaction.amount)).toEqual([-10000, -10000]);

    const history = await http(app)
      .get(`/meters/${meterId}/price-history`)
      .set(auth(tenancy.adminToken));
    expect(history.status).toBe(200);
    expect(history.body.items.map((item: { unitPrice: number }) => item.unitPrice)).toEqual([200, 100]);
  });

  it('同一 messageId 重复上报只落一条读数，重复请求幂等返回', async () => {
    const base = await seedBase();
    const tenancy = await setupMeterTenancy(base);
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100);

    const payload = readingBody(88.5, '2026-03-10T02:00:00.000Z', {
      source: 'DEVICE',
      messageId: 'msg-integration-1',
    });
    const first = await http(app)
      .post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(payload);
    const second = await http(app)
      .post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.reading.id).toBe(first.body.reading.id);
    expect(second.body.deduction.reason).toContain('重复读数');

    const count = await prisma.meterReading.count({
      where: { meterId, dedupKey: 'msg:msg-integration-1' },
    });
    expect(count).toBe(1);
  });

  it('并发结算同一块表只扣一次费', async () => {
    const base = await seedBase();
    const tenancy = await setupMeterTenancy(base);
    await preparePrepay(tenancy.adminToken, tenancy.tenantId, tenancy.roomId);
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100);

    // 设备采集、不自动结算，留给并发结算触发
    const reading = await http(app)
      .post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(
        readingBody(40, '2026-04-10T02:00:00.000Z', {
          source: 'DEVICE',
          messageId: 'msg-integration-concurrent',
        }),
      );
    expect(reading.status).toBe(201);

    const settle = () =>
      http(app).post(`/meters/${meterId}/settle`).set(auth(tenancy.adminToken)).send({});
    const [first, second] = await Promise.all([settle(), settle()]);

    const results = [first.body, second.body];
    const settledCount = results.filter((body) => body.settled === true).length;
    expect(settledCount).toBe(1);

    const deductions = await prisma.prepayTransaction.findMany({
      where: { relatedType: 'METER_READING' },
    });
    expect(deductions).toHaveLength(1);
    expect(deductions[0].amount).toBe(-4000);

    const settledReading = await prisma.meterReading.findFirstOrThrow({
      where: { meterId, dedupKey: 'msg:msg-integration-concurrent' },
    });
    expect(settledReading.settledAt).not.toBeNull();
    expect(settledReading.settledUsage?.toString()).toBe('40');
    expect(settledReading.settledUnitPrice).toBe(100);
    expect(settledReading.settledAmount).toBe(4000);
  });

  it('采集备注中的保留标记不能使未结算读数被视为已结算', async () => {
    const base = await seedBase();
    const tenancy = await setupMeterTenancy(base);
    await preparePrepay(tenancy.adminToken, tenancy.tenantId, tenancy.roomId);
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100);
    const reading = await http(app).post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(readingBody(40, '2026-04-10T02:00:00.000Z', {
        source: 'DEVICE', messageId: 'marker-input-test', notes: '[SETTLED]',
      }));
    expect(reading.status).toBe(400);
    const forgedMessage = await http(app).post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(readingBody(40, '2026-04-10T02:00:00.000Z', { source: 'DEVICE', messageId: 'fake[INITIAL]' }));
    expect(forgedMessage.status).toBe(400);
    const batch = await http(app).post('/meters/batch-readings')
      .set(auth(tenancy.adminToken))
      .send({ readings: [
        { meterId, currentReading: 40, source: 'DEVICE', notes: '[INITIAL]' },
        { meterId, currentReading: 40, source: 'DEVICE', messageId: 'fake[SETTLED]' },
      ] });
    expect(batch.status).toBe(201);
    expect(batch.body).toMatchObject({ total: 2, successCount: 0, failureCount: 2 });
    const accepted = await http(app).post(`/meters/${meterId}/readings`)
      .set(auth(tenancy.adminToken))
      .send(readingBody(40, '2026-04-10T02:00:00.000Z', { source: 'DEVICE', messageId: 'valid-marker-test' }));
    expect(accepted.status).toBe(201);
    const result = await http(app).post(`/meters/${meterId}/settle`)
      .set(auth(tenancy.adminToken)).send({});
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ settled: true, usage: 40, amount: 4000 });
  });

});

describe('水电结算并发和历史截止时间（CORE-02）', () => {
  const time110 = '2026-04-10T02:00:00.000Z';
  const time120 = '2026-04-11T02:00:00.000Z';

  async function prepare() {
    const base = await seedBase();
    const tenancy = await setupMeterTenancy(base);
    const accountId = await preparePrepay(tenancy.adminToken, tenancy.tenantId, tenancy.roomId);
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100, 100);
    const post = (path: string) => http(app).post(path).set(auth(tenancy.adminToken));
    const record = (currentReading: number, readingTime: string, source = 'MANUAL') =>
      post(`/meters/${meterId}/readings`).send({ currentReading, readingTime, source });
    const batch = (currentReading: number, readingTime: string) =>
      post('/meters/batch-readings').send({ readings: [{ meterId, currentReading, readingTime }] });
    const settle = (settleUntil: string) => post(`/meters/${meterId}/settle`).send({ settleUntil });
    const preview = (settleUntil: string) => http(app)
      .get(`/meters/${meterId}/unsettled-usage`).set(auth(tenancy.adminToken)).query({ settleUntil });
    return { accountId, meterId, record, batch, settle, preview };
  }

  async function interleave(
    first: () => PromiseLike<Response>,
    second: () => PromiseLike<Response>,
  ) {
    const billing = app.get(MeterBillingService);
    const apply = billing.applyReadingDeduction.bind(billing);
    let entered!: () => void;
    let unblock!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const release = new Promise<void>((resolve) => { unblock = resolve; });
    const pause = vi.spyOn(billing, 'applyReadingDeduction').mockImplementationOnce(async (...args) => {
      entered();
      await release;
      return apply(...args);
    });
    const firstRequest = Promise.resolve(first());
    let secondRequest: Promise<Response> | undefined;
    try {
      await Promise.race([
        ready,
        firstRequest.then((response) => {
          throw new Error(`First request finished before reaching settlement: ${response.status}`);
        }),
      ]);
      secondRequest = Promise.resolve(second());
      const deadline = Date.now() + 2500;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND query LIKE '%FROM "meters"%FOR UPDATE%'
              AND cardinality(pg_blocking_pids(pid)) > 0
          ) AS waiting
        `;
        waiting = rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      unblock();
      return await Promise.all([firstRequest, secondRequest]);
    } finally {
      unblock();
      await Promise.allSettled(secondRequest ? [firstRequest, secondRequest] : [firstRequest]);
      pause.mockRestore();
    }
  }

  async function expectTotals(meterId: string, accountId: string, usage: number) {
    const settled = await prisma.meterReading.aggregate({
      where: { meterId },
      _sum: { settledUsage: true, settledAmount: true },
    });
    expect(Number(settled._sum.settledUsage)).toBe(usage);
    expect(settled._sum.settledAmount).toBe(usage * 100);
    const ledger = await prisma.prepayTransaction.aggregate({
      where: { accountId, relatedType: 'METER_READING' },
      _sum: { amount: true },
    });
    expect(ledger._sum.amount).toBe(-usage * 100);
    const account = await prisma.prepayAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.balanceCache).toBe(100000 - usage * 100);
    expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(0);
  }

  it.each(['manual', 'batch', 'periodic'] as const)(
    '手工先结算 110，%s 并发请求等待同一表计锁，最终只计费 20',
    async (path) => {
      const { record, batch, settle, meterId, accountId } = await prepare();
      const second = {
        manual: () => record(120, time120),
        batch: () => batch(120, time120),
        periodic: () => settle(time120),
      };
      const [first, next] = await interleave(() => record(110, time110), second[path]);
      expect(first.status).toBe(201);
      expect(first.body.deduction).toMatchObject({ applied: true, amount: 1000 });
      expect(next.status).toBe(201);
      if (path === 'manual') expect(next.body.deduction).toMatchObject({ applied: true, amount: 1000 });
      if (path === 'batch') expect(next.body.results[0]).toMatchObject({ success: true, amount: 1000 });
      if (path === 'periodic') {
        expect(next.body).toMatchObject({ settled: false, amount: 0 });
        expect((await record(120, time120)).body.deduction).toMatchObject({ amount: 1000 });
      }
      await expectTotals(meterId, accountId, 20);
    },
  );

  it('周期先结算 110，手工 120 在锁内重读后只扣增量', async () => {
    const { record, settle, meterId, accountId } = await prepare();
    expect((await record(110, time110, 'DEVICE')).status).toBe(201);
    const [first, second] = await interleave(() => settle(time110), () => record(120, time120));
    expect(first.body).toMatchObject({ settled: true, usage: 10, amount: 1000 });
    expect(second.body.deduction).toMatchObject({ applied: true, amount: 1000 });
    await expectTotals(meterId, accountId, 20);
  });

  it('120 已结算后补报 110，历史预览和结算都不重复处理已覆盖区间', async () => {
    const { record, settle, preview, meterId, accountId } = await prepare();
    expect((await record(120, time120)).body.deduction).toMatchObject({ amount: 2000 });
    const historical = await record(110, time110);
    expect(historical.status).toBe(201);
    expect(historical.body.deduction).toMatchObject({ applied: false });
    const estimate = await preview(time110);
    expect(estimate.status).toBe(200);
    expect.soft(estimate.body).toMatchObject({ unsettledUsage: 0, estimatedAmount: 0 });
    const result = await settle(time110);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ settled: false, usage: 0, amount: 0 });
    const stored = await prisma.meterReading.findUniqueOrThrow({ where: { id: historical.body.reading.id } });
    expect(stored.settledAt).toBeNull();
    await expectTotals(meterId, accountId, 20);
  });
});
