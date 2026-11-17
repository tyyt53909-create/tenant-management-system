import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { MeterBillingService } from '../../src/modules/meters/meter-billing.service.js';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';

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
