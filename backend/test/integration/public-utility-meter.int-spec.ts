import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';

let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); });

describe('公共水电表归属', () => {
  it('拒绝房间表，保留公区及未绑定表，校验楼栋、类型和角色', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const area = await prisma.publicArea.create({ data: { buildingId: base.buildingId, name: '走廊', areaType: 'HALLWAY' } });
    const roomMeter = await prisma.meter.create({ data: { buildingId: base.buildingId, roomId: tenancy.roomId, meterType: 'ELECTRICITY', meterNumber: 'room-meter', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') } });
    const mixedMeter = await prisma.meter.create({ data: { buildingId: base.buildingId, roomId: tenancy.roomId, publicAreaId: area.id, meterType: 'ELECTRICITY', meterNumber: 'mixed-meter', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') } });
    const publicMeter = await prisma.meter.create({ data: { buildingId: base.buildingId, publicAreaId: area.id, meterType: 'ELECTRICITY', meterNumber: 'public-meter', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') } });
    const unboundMeter = await prisma.meter.create({ data: { buildingId: base.buildingId, meterType: 'ELECTRICITY', meterNumber: 'unbound-meter', unitPrice: 100, priceEffectiveDate: new Date('2026-01-01') } });
    for (const meter of [roomMeter, publicMeter, unboundMeter]) {
      await prisma.meterReading.createMany({ data: [
        { meterId: meter.id, currentReading: 10, previousReading: 10, usage: 0, source: 'MANUAL', readingTime: new Date('2026-01-03') },
        { meterId: meter.id, currentReading: 20, previousReading: 10, usage: 10, source: 'MANUAL', readingTime: new Date('2026-01-20') },
      ] });
    }
    const payload = (meterId: string, extra = {}) => ({ buildingId: base.buildingId, meterType: 'ELECTRICITY', period: '2026-01', meterId, unitPrice: 100, ...extra });
    const post = (path: string, body: object, token = tenancy.adminToken) => http(app).post(path).set(auth(token)).send(body);
    expect((await post('/public-utilities/preview', payload(roomMeter.id))).status).toBe(400);
    expect((await post('/public-utilities', payload(roomMeter.id))).status).toBe(400);
    expect((await post('/public-utilities', payload(mixedMeter.id))).status).toBe(400);
    expect(await prisma.publicUtilityBill.count()).toBe(0);
    expect(await prisma.publicUtilityAllocation.count()).toBe(0);
    expect((await post('/public-utilities/preview', payload(publicMeter.id))).body.totalAmount).toBe(1000);
    expect((await post('/public-utilities/preview', payload(unboundMeter.id))).body.totalAmount).toBe(1000);
    const created = await post('/public-utilities', payload(publicMeter.id));
    expect(created.status).toBe(201);
    expect(created.body.totalAmount).toBe(1000);
    expect((await post('/public-utilities/preview', payload(publicMeter.id, { meterType: 'WATER' }))).status).toBe(400);
    const other = await prisma.building.create({ data: { name: '另一个楼栋', floors: 1 } });
    expect((await post('/public-utilities/preview', payload(publicMeter.id, { buildingId: other.id }))).status).toBe(400);
    expect((await post('/public-utilities/preview', payload(publicMeter.id), tenancy.tenantToken)).status).toBe(403);
  });
});
