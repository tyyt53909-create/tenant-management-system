import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { MeterBillingService } from '../../src/modules/meters/meter-billing.service.js';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth, login } from './harness.js';

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
  initialReading: number | null = 0,
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
      initialReading: initialReading ?? undefined,
    });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function preparePrepay(adminToken: string, tenantId: string, roomId: string) {
  const account = await http(app)
    .post('/prepay-accounts')
    .set(auth(adminToken))
    .send({ tenantId, roomId });
  expect(account.status).toBe(201);

  const recharge = await http(app)
    .post(`/prepay-accounts/${account.body.id}/transactions`)
    .set(auth(adminToken))
    .send({ type: 'RECHARGE', amount: 100000, description: '集成测试充值' });
  expect(recharge.status).toBe(201);
  return account.body.id as string;
}

function readingBody(currentReading: number, readingTime: string, extra: Record<string, unknown> = {}) {
  return { currentReading, readingTime, ...extra };
}

describe('抄表与计价（FIN-08）', () => {
  it('批量结算区分四类结果；缺账户补办、余额不足和失败重试均可核账', async () => {
    const base = await seedBase();
    const blockedTenancy = await setupTenancy(app, base);
    const fundedTenancy = await setupTenancy(app, base);
    const { adminToken } = blockedTenancy;
    const fundedAccount = await preparePrepay(adminToken, fundedTenancy.tenantId, fundedTenancy.roomId);
    const blocked = await createMeter(adminToken, base.buildingId, blockedTenancy.roomId, 100, 100);
    const zero = await createMeter(adminToken, base.buildingId, blockedTenancy.roomId, 100, 100);
    const funded = await createMeter(adminToken, base.buildingId, fundedTenancy.roomId, 100, 100);
    const failing = await createMeter(adminToken, base.buildingId, fundedTenancy.roomId, 100, 100);
    const readingTime = new Date(Date.now() + 1000).toISOString();
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

  it('缺账户重试沿用服务端预览截止时间，后续读数留给重新确认', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100, 100);
    const headers = auth(tenancy.adminToken);
    const record = (value: number, readingTime?: string) => http(app).post(`/meters/${meterId}/readings`)
      .set(headers).send({ currentReading: value, readingTime, autoSettle: false }).expect(201);
    const original = (await record(110)).body.reading;
    const preview = (await http(app).get(`/meters/${meterId}/unsettled-usage`).set(headers).expect(200)).body;
    expect(preview).toMatchObject({ targetReadingId: original.id, unsettledUsage: 10, estimatedAmount: 1000 });
    const input = {
      settleUntil: preview.settleUntil,
      expectedTargetReadingId: preview.targetReadingId,
      expectedBaselineReading: preview.lastSettledReading,
    };
    const settle = () => http(app).post(`/meters/${meterId}/settle`).set(headers).send(input).expect(201);
    expect((await settle()).body).toMatchObject({ status: 'BLOCKED', reasonCode: 'MISSING_PREPAY_ACCOUNT' });

    const laterTime = new Date(new Date(preview.settleUntil).getTime() + 1).toISOString();
    const later = (await record(125, laterTime)).body.reading;
    await preparePrepay(tenancy.adminToken, tenancy.tenantId, tenancy.roomId);
    const result = (await settle()).body;
    expect(result).toMatchObject({ status: 'SETTLED', usage: 10, amount: 1000 });
    expect(await prisma.prepayTransaction.findUniqueOrThrow({ where: { id: result.prepayTransactionId } }))
      .toMatchObject({ relatedId: original.id, amount: -1000 });
    expect(await prisma.meterReading.findUniqueOrThrow({ where: { id: later.id } }))
      .toMatchObject({ settledAt: null, settledAmount: null });
    const refreshed = (await http(app).get(`/meters/${meterId}/unsettled-usage`).query({ settleUntil: laterTime })
      .set(headers).expect(200)).body;
    expect(refreshed).toMatchObject({ targetReadingId: later.id, unsettledUsage: 15, estimatedAmount: 1500 });
  });

  it('截止时间内补录改变目标时，旧确认返回 PREVIEW_STALE 且不会扣款', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const accountId = await preparePrepay(tenancy.adminToken, tenancy.tenantId, tenancy.roomId);
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100, 100);
    const headers = auth(tenancy.adminToken);
    const record = (currentReading: number, readingTime: string) => http(app).post(`/meters/${meterId}/readings`)
      .set(headers).send({ currentReading, readingTime, autoSettle: false }).expect(201);
    const now = Date.now();
    const settleUntil = new Date(now + 1500).toISOString();
    const original = (await record(110, new Date(now + 500).toISOString())).body.reading;
    const preview = (await http(app).get(`/meters/${meterId}/unsettled-usage`).query({ settleUntil })
      .set(headers).expect(200)).body;
    expect(preview).toMatchObject({ settleUntil, targetReadingId: original.id, unsettledUsage: 10 });
    const replacement = (await record(125, new Date(now + 1000).toISOString())).body.reading;
    const settle = (expectedTargetReadingId: string) => http(app).post(`/meters/${meterId}/settle`)
      .set(headers).send({ settleUntil, expectedTargetReadingId }).expect(201);
    expect((await settle(preview.targetReadingId)).body).toMatchObject({
      status: 'BLOCKED', reasonCode: 'PREVIEW_STALE', settled: false, amount: 0,
    });
    expect(await prisma.prepayTransaction.count({ where: { accountId, type: 'DEDUCTION' } })).toBe(0);
    expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(0);
    expect(await prisma.meterReading.count({ where: { id: { in: [original.id, replacement.id] }, settledAt: null } })).toBe(2);

    const refreshed = (await http(app).get(`/meters/${meterId}/unsettled-usage`).query({ settleUntil })
      .set(headers).expect(200)).body;
    expect(refreshed).toMatchObject({ targetReadingId: replacement.id, unsettledUsage: 25 });
    expect((await settle(refreshed.targetReadingId)).body).toMatchObject({ status: 'SETTLED', amount: 2500 });
  });

  it('仅底数变化时也须重新确认，防止补录读数扩大应收用量', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const accountId = await preparePrepay(tenancy.adminToken, tenancy.tenantId, tenancy.roomId);
    // 模拟只有历史普通读数、尚未形成结算游标的表。
    const meterId = await createMeter(tenancy.adminToken, base.buildingId, tenancy.roomId, 100, null);
    const headers = auth(tenancy.adminToken);
    await prisma.meterReading.createMany({
      data: [100, 110].map((value, index) => ({
        meterId, source: 'MANUAL', readingTime: new Date(`2026-04-0${index + 2}T00:00:00Z`),
        currentReading: value, previousReading: 100, usage: value - 100,
      })),
    });
    const preview = (await http(app).get(`/meters/${meterId}/unsettled-usage`).set(headers).expect(200)).body;
    expect(preview).toMatchObject({ lastSettledReading: 100, unsettledUsage: 10 });
    await http(app).post(`/meters/${meterId}/readings`).set(headers)
      .send(readingBody(90, '2026-04-01T00:00:00Z', { autoSettle: false })).expect(201);
    const input = {
      settleUntil: preview.settleUntil,
      expectedTargetReadingId: preview.targetReadingId,
      expectedBaselineReading: preview.lastSettledReading,
    };
    const result = await http(app).post(`/meters/${meterId}/settle`).set(headers).send(input).expect(201);
    expect(result.body).toMatchObject({ status: 'BLOCKED', reasonCode: 'PREVIEW_STALE', amount: 0 });
    expect(await prisma.prepayTransaction.count({ where: { accountId, type: 'DEDUCTION' } })).toBe(0);
    const refreshed = (await http(app).get(`/meters/${meterId}/unsettled-usage`).set(headers).expect(200)).body;
    expect(refreshed).toMatchObject({ targetReadingId: preview.targetReadingId, lastSettledReading: 90, unsettledUsage: 20 });
  });

  it('空范围不能结算任何表，显式楼栋只结算自己的在用表', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);
    const otherBuilding = await prisma.building.create({ data: { name: '另一楼栋', floors: 2 } });
    const meter = await prisma.meter.create({
      data: { buildingId: base.buildingId, meterType: 'ELECTRICITY', meterNumber: 'SCOPED', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') },
    });
    const otherMeter = await prisma.meter.create({
      data: { buildingId: otherBuilding.id, meterType: 'ELECTRICITY', meterNumber: 'OTHER', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') },
    });
    const readingTime = new Date();
    await prisma.meterReading.createMany({
      data: [meter.id, otherMeter.id].map((meterId) => ({ meterId, readingTime, currentReading: 10, previousReading: 10, usage: 0, source: 'MANUAL' })),
    });
    const settle = (input: Record<string, unknown>) => http(app).post('/meters/settle-batch').set(auth(adminToken)).send(input);
    for (const input of [{}, { buildingId: ' ' }, { buildingId: base.buildingId, meterIds: null }]) {
      await settle(input).expect(400);
    }
    for (const input of [{ meterIds: [] }, { buildingId: base.buildingId, meterIds: [] }]) {
      expect((await settle(input).expect(201)).body).toMatchObject({ total: 0, results: [] });
    }
    expect(await prisma.meterReading.count({ where: { settledAt: { not: null } } })).toBe(0);
    expect((await settle({ buildingId: base.buildingId }).expect(201)).body).toMatchObject({
      total: 1, results: [{ meterId: meter.id, reasonCode: 'ZERO_USAGE' }],
    });
    expect(await prisma.meterReading.findMany({ where: { settledAt: { not: null } }, select: { meterId: true } }))
      .toEqual([{ meterId: meter.id }]);
  });

  it('批量登记保留无合同及缺账户读数，并返回逐表扣费阻塞原因', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const vacant = await prisma.room.create({
      data: { buildingId: base.buildingId, roomNumber: 'VACANT', floor: 1, roomType: 'SINGLE', area: 25 },
    });
    const meterIds = await Promise.all([vacant.id, tenancy.roomId].map((roomId) =>
      createMeter(tenancy.adminToken, base.buildingId, roomId, 100, 100)));
    const readingTime = new Date(Date.now() + 20).toISOString();
    const readings = [...meterIds, 'missing-meter'].map((meterId) => ({
      meterId, currentReading: 110, readingTime, autoSettle: true,
    }));
    const response = await http(app).post('/meters/batch-readings').set(auth(tenancy.adminToken)).send({ readings }).expect(201);
    expect(response.body).toMatchObject({
      successCount: 2, failureCount: 1, results: [
        { meterId: meterIds[0], success: true, deductionBlocked: { reasonCode: 'NO_ACTIVE_CONTRACT', reason: expect.any(String), retryCondition: expect.any(String) } },
        { meterId: meterIds[1], success: true, deductionBlocked: { reasonCode: 'MISSING_PREPAY_ACCOUNT', reason: expect.any(String), retryCondition: expect.any(String) } },
        { meterId: 'missing-meter', success: false, error: expect.any(String) },
      ],
    });
    expect(await prisma.meterReading.count({ where: { meterId: { in: meterIds }, readingTime, settledAt: null } })).toBe(2);
    expect(await prisma.prepayTransaction.count({ where: { relatedType: 'METER_READING' } })).toBe(0);
    expect(await prisma.bill.count({ where: { billType: 'UTILITY' } })).toBe(0);
  });

  it('调价跨月后按读数业务日的生效价结算，历史读数不被新价重算', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
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
    const tenancy = await setupTenancy(app, base);
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
    const tenancy = await setupTenancy(app, base);
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
    const tenancy = await setupTenancy(app, base);
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
    const tenancy = await setupTenancy(app, base);
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
