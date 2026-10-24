import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
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
      initialReading: 0,
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
});
