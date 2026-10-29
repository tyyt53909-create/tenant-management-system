import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { RoomStatusSnapshotService } from '../../src/modules/dashboard/room-status-snapshot.service.js';
import type { PrismaService } from '../../src/modules/prisma/prisma.service.js';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth, login } from './harness.js';

let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDatabase(); });

describe('T307 immutable room history', () => {
  it('captures one consistent row per building and day, concurrent retries preserve history', async () => {
    const base = await seedBase();
    const empty = await prisma.building.create({ data: { name: 'empty', floors: 1 } });
    for (const [i, status] of (['VACANT', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'] as const).entries()) {
      await prisma.room.create({ data: { buildingId: base.buildingId, floor: 1, roomNumber: String(i), roomType: 'STUDIO', status } });
    }
    const clock = new BusinessClock(new ConfigService({ BUSINESS_TIMEZONE: 'Asia/Shanghai' }));
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-10-28T15:59:59Z'));
    const service = new RoomStatusSnapshotService(prisma as PrismaService, clock);
    const rows = await Promise.all(Array.from({ length: 8 }, () => service.capture(base.buildingId)));
    expect(new Set(rows.map(row => row.id)).size).toBe(1);
    expect(rows[0]).toMatchObject({ total: 4, vacant: 1, occupied: 1, reserved: 1, maintenance: 1, businessDate: new Date('2026-10-28T00:00:00Z') });
    expect((await service.capture(empty.id)).total).toBe(0);
    await prisma.room.updateMany({ where: { buildingId: base.buildingId }, data: { status: 'VACANT' } });
    expect(await service.capture(base.buildingId)).toEqual(rows[0]);
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-10-28T16:00:00Z'));
    const next = await service.capture(base.buildingId);
    expect(next).toMatchObject({ total: 4, vacant: 4, businessDate: new Date('2026-10-29T00:00:00Z') });
    expect(await service.get(base.buildingId, '2026-10-27')).toBeNull();
    expect(await service.get(base.buildingId, '2026-10-28')).toEqual(rows[0]);
    await expect(service.capture('missing')).rejects.toThrow('楼栋不存在');
    await expect(service.get(base.buildingId, '2026-02-30')).rejects.toThrow();
    expect(await prisma.roomStatusSnapshot.count({ where: { buildingId: empty.id } })).toBe(1);
  });
  it('rolls back if capture work crosses the business-day boundary', async () => {
    const base = await seedBase();
    const clock = new BusinessClock(new ConfigService({ BUSINESS_TIMEZONE: 'Asia/Shanghai' }));
    vi.spyOn(clock, 'now').mockReturnValueOnce(new Date('2026-10-28T15:59:59Z')).mockReturnValueOnce(new Date('2026-10-28T16:00:00Z'));
    const service = new RoomStatusSnapshotService(prisma as PrismaService, clock);
    await expect(service.capture(base.buildingId)).rejects.toThrow('捕获跨越业务日');
    expect(await prisma.roomStatusSnapshot.count({ where: { buildingId: base.buildingId } })).toBe(0);
  });
  it('restricts capture and history to authenticated ADMIN and rejects backdating', async () => {
    const base = await seedBase();
    const admin = await login(app, base.adminEmail, base.adminPassword);
    const cleaner = await login(app, base.cleanerEmail, base.cleanerPassword);
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: base.adminId } });
    for (const role of ['PROPERTY_MANAGER'] as const) {
      const email = `${role.toLowerCase()}-snapshot@example.com`;
      await prisma.user.create({ data: { email, passwordHash: adminUser.passwordHash, role, isActive: true } });
      const token = await login(app, email, base.adminPassword);
      await http(app).get(`/dashboard/room-status-history/${base.buildingId}?date=2026-01-01`).set(auth(token)).expect(403);
      await http(app).post(`/dashboard/room-status-history/${base.buildingId}/capture`).set(auth(token)).expect(403);
    }
    const tenancy = await setupTenancy(app, base);
    const other = await prisma.building.create({ data: { name: 'other building', floors: 1 } });
    for (const buildingId of [base.buildingId, other.id]) {
      await http(app).get(`/dashboard/room-status-history/${buildingId}?date=2026-01-01`).set(auth(tenancy.tenantToken)).expect(403);
      await http(app).post(`/dashboard/room-status-history/${buildingId}/capture`).set(auth(tenancy.tenantToken)).expect(403);
    }
    const url = `/dashboard/room-status-history/${base.buildingId}`;
    await http(app).get(`${url}?date=2026-01-01`).expect(401);
    await http(app).get(`${url}?date=2026-01-01`).set(auth(cleaner)).expect(403);
    await http(app).post(`${url}/capture`).set(auth(cleaner)).expect(403);
    await http(app).post(`${url}/capture`).set(auth(admin)).send({ date: '2020-01-01' }).expect(400);
    await http(app).post(`${url}/capture?date=2020-01-01`).set(auth(admin)).expect(400);
    await http(app).get(`${url}?date=2026-01-01`).set(auth(admin)).expect(200).expect({ snapshot: null });
    await http(app).post(`${url}/capture`).set(auth(admin)).expect(201);
    await http(app).get('/dashboard/room-status-history/no-such-building?date=2026-01-01').set(auth(admin)).expect(404);
  });
});
