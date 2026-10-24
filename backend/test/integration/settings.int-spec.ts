import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, login, http, auth } from './harness.js';

/** FIN-11 / T276：设置中心与业务默认值（真实 DB） */
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

async function adminToken() {
  const base = await seedBase();
  const token = await login(app, base.adminEmail, base.adminPassword);
  return { base, token };
}

async function putSetting(token: string, key: string, value: unknown) {
  return http(app)
    .patch(`/settings/${key}`)
    .set(auth(token))
    .send({ value });
}

describe('设置中心（FIN-11）', () => {
  it('读取默认值 → 更新 → 审计 before/after；未知 key / 非法值被拒', async () => {
    const { token } = await adminToken();

    const initial = await http(app).get('/settings').set(auth(token));
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'prepay.defaultLowBalanceThreshold',
          value: 10000,
          isDefault: true,
        }),
        expect.objectContaining({
          key: 'billing.defaultLateFeeRule',
          value: expect.objectContaining({ graceDays: 0 }),
          isDefault: true,
        }),
      ]),
    );

    const updated = await putSetting(token, 'prepay.defaultLowBalanceThreshold', 25000);
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ value: 25000, isDefault: false, updatedBy: expect.any(String) });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'UPDATE_SETTING', entityId: 'prepay.defaultLowBalanceThreshold' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.changes).toMatchObject({ before: 10000, after: 25000 });

    const unknown = await putSetting(token, 'billing.unknown', 1);
    expect(unknown.status).toBe(404);

    const invalid = await putSetting(token, 'prepay.defaultLowBalanceThreshold', -1);
    expect(invalid.status).toBe(400);

    const badRule = await putSetting(token, 'billing.defaultLateFeeRule', { typo: 1 });
    expect(badRule.status).toBe(400);
  });

  it('新合同继承默认滞纳金规则，显式传入仍优先', async () => {
    const { base, token } = await adminToken();
    const saved = await putSetting(token, 'billing.defaultLateFeeRule', {
      graceDays: 5,
      fixedDaily: 100,
      cap: 10000,
    });
    expect(saved.status).toBe(200);

    const tenancy = await setupTenancy(app, base);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: tenancy.contractId } });
    expect(contract.lateFeeRule).toEqual({
      graceDays: 5,
      dailyRate: null,
      fixedDaily: 100,
      cap: 10000,
    });

    const room = await http(app)
      .post('/rooms')
      .set(auth(tenancy.adminToken))
      .send({ buildingId: base.buildingId, roomNumber: `IT-EXPLICIT-${Date.now()}`, floor: 2, roomType: 'SINGLE', area: 20 });
    const contractExplicit = await http(app)
      .post('/contracts')
      .set(auth(tenancy.adminToken))
      .send({
        buildingId: base.buildingId,
        roomId: room.body.id,
        tenantId: tenancy.tenantId,
        rentAmount: 100000,
        depositAmount: 100000,
        paymentCycle: 'MONTHLY',
        paymentDay: 1,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        lateFeeRule: { graceDays: 1, dailyRate: 0.001 },
      });
    expect(contractExplicit.status).toBe(201);
    expect(contractExplicit.body.lateFeeRule).toEqual({ graceDays: 1, dailyRate: 0.001 });
  });

  it('新预付账户继承默认阈值，显式 0 保留', async () => {
    const { base, token } = await adminToken();
    const saved = await putSetting(token, 'prepay.defaultLowBalanceThreshold', 25000);
    expect(saved.status).toBe(200);

    const tenancy = await setupTenancy(app, base);
    const account = await http(app)
      .post('/prepay-accounts')
      .set(auth(tenancy.adminToken))
      .send({ tenantId: tenancy.tenantId, roomId: tenancy.roomId });
    expect(account.status).toBe(201);
    expect(account.body.lowBalanceThreshold).toBe(25000);

    const secondRoom = await http(app)
      .post('/rooms')
      .set(auth(tenancy.adminToken))
      .send({ buildingId: base.buildingId, roomNumber: `IT-ZERO-${Date.now()}`, floor: 2, roomType: 'SINGLE', area: 20 });
    const zero = await http(app)
      .post('/prepay-accounts')
      .set(auth(tenancy.adminToken))
      .send({ tenantId: tenancy.tenantId, roomId: secondRoom.body.id, lowBalanceThreshold: 0 });
    expect(zero.status).toBe(201);
    expect(zero.body.lowBalanceThreshold).toBe(0);
  });

  it('水电表类型默认价：设置后可不传单价建表；未配置的类型 400', async () => {
    const { base, token } = await adminToken();

    const setDefault = await http(app)
      .post('/meters/price-defaults')
      .set(auth(token))
      .send({ meterType: 'WATER', unitPrice: 420, effectiveDate: '2026-01-01' });
    expect(setDefault.status).toBe(201);
    expect(setDefault.body).toMatchObject({ unitPrice: 420, meterId: null });

    const defaults = await http(app).get('/meters/price-defaults').set(auth(token));
    expect(defaults.status).toBe(200);
    expect(defaults.body.find((row: { meterType: string }) => row.meterType === 'WATER')).toMatchObject({
      unitPrice: 420,
    });

    const room = await http(app)
      .post('/rooms')
      .set(auth(token))
      .send({ buildingId: base.buildingId, roomNumber: `IT-METER-${Date.now()}`, floor: 1, roomType: 'SINGLE', area: 20 });
    expect(room.status).toBe(201);

    const meter = await http(app)
      .post('/meters')
      .set(auth(token))
      .send({
        buildingId: base.buildingId,
        roomId: room.body.id,
        meterType: 'WATER',
        meterNumber: `W-${Date.now()}`,
        priceEffectiveDate: '2026-01-01',
      });
    expect(meter.status).toBe(201);
    expect(meter.body.unitPrice).toBe(420);

    const noDefault = await http(app)
      .post('/meters')
      .set(auth(token))
      .send({
        buildingId: base.buildingId,
        roomId: room.body.id,
        meterType: 'GAS',
        meterNumber: `G-${Date.now()}`,
        priceEffectiveDate: '2026-01-01',
      });
    expect(noDefault.status).toBe(400);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'UPDATE_METER_DEFAULT_PRICE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.changes).toMatchObject({ after: expect.objectContaining({ unitPrice: 420 }) });
  });
});
