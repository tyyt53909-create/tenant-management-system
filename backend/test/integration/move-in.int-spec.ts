import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';

let app: INestApplication;
beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await app?.close(); });
beforeEach(resetDatabase);

async function prepare(roomNumber: string) {
  const base = await seedBase();
  const admin = auth(await login(app, base.adminEmail, base.adminPassword));
  const tenant = await prisma.tenant.create({ data: { name: '入住测试', phone: '13800003320' } });
  const room = await prisma.room.create({ data: {
    buildingId: base.buildingId, roomNumber, floor: 1, roomType: 'SINGLE',
  } });
  const clock = app.get(BusinessClock);
  const today = clock.todayUtc();
  const start = new Date(today.getTime());
  start.setUTCDate(1);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const lease = {
    buildingId: base.buildingId, roomId: room.id, tenantId: tenant.id,
    rentAmount: 300000, depositAmount: 500000, paymentCycle: 'MONTHLY', paymentDay: 1,
    startDate: date(start), endDate: date(clock.addDays(today, 365)),
  };
  const meter = await prisma.meter.create({ data: {
    buildingId: base.buildingId, roomId: room.id, priceEffectiveDate: today,
    meterType: 'ELECTRICITY', meterNumber: `M-${roomNumber}`, unitPrice: 100,
  } });
  const endpoint = `/rooms/${room.id}/move-in`;
  const preview = (selection: unknown) => http(app).post(`${endpoint}/preview`).set(admin).send(selection as object);
  const submit = (data: unknown) => http(app).post(endpoint).set(admin).send(data as object);
  return { admin, tenant, room, lease, meter, preview, submit };
}

it('writes all check-in records once under concurrent requests and replays the persisted result', async () => {
  const { admin, tenant, room, lease, meter, preview, submit } = await prepare('MOVE-IN');
  const review = await preview({ contract: lease });
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  expect(review.body.bills).toMatchObject([{ billType: 'RENT', amount: 300000 }, { billType: 'DEPOSIT', amount: 500000 }]);
  expect(review.body.meters).toMatchObject([{ id: meter.id }]);
  expect(await prisma.contract.count()).toBe(0);

  const data = {
    requestId: randomUUID(), reviewToken: review.body.reviewToken, contract: lease,
    readings: [{ meterId: meter.id, currentReading: 15.2 }],
  };
  const [first, concurrent] = await Promise.all([submit(data), submit(data)]);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  expect(concurrent.status, JSON.stringify(concurrent.body)).toBe(201);
  expect(first.body).toEqual(concurrent.body);
  expect((await submit(data)).body).toEqual(first.body);
  expect((await submit({ ...data, readings: [{ meterId: meter.id, currentReading: 15.3 }] })).status).toBe(409);
  expect((await submit({ ...data, requestId: randomUUID() })).status).toBe(409);

  expect(await prisma.contract.findMany({ where: { roomId: room.id } }))
    .toMatchObject([{ id: first.body.contractId, status: 'ACTIVE', leaseConfirmedAt: expect.any(Date) }]);
  expect(await prisma.bill.count({ where: { contractId: first.body.contractId } })).toBe(2);
  const deposit = await prisma.bill.findFirstOrThrow({ where: { contractId: first.body.contractId, billType: 'DEPOSIT' } });
  expect(deposit).toMatchObject({ status: 'PENDING', amount: 500000 });
  expect(await prisma.paymentRecord.count()).toBe(0);
  expect(await prisma.prepayAccount.findMany({ where: { tenantId: tenant.id, roomId: room.id } }))
    .toMatchObject([{ id: first.body.prepayAccountId, balanceCache: 0 }]);
  expect(await prisma.meterReading.findMany({ where: { meterId: meter.id } }))
    .toMatchObject([{ id: first.body.baselines[0].readingId, readingTime: new Date(first.body.occupiedAt), settledAmount: 0 }]);
  expect(await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
    .toMatchObject({ status: 'OCCUPIED', version: room.version + 1 });

  const reading = await http(app).post(`/meters/${meter.id}/readings`).set(admin)
    .send({ currentReading: 16.2, autoSettle: true });
  expect(reading.status, JSON.stringify(reading.body)).toBe(201);
  expect(reading.body.deduction).toMatchObject({ applied: true, amount: 100 });
});

it('rolls back every write when PostgreSQL rejects the final room update and accepts the same request afterward', async () => {
  const { tenant, room, lease, meter, preview, submit } = await prepare('MOVE-IN-ROLLBACK');
  const review = await preview({ contract: lease });
  expect(review.status).toBe(201);
  const data = {
    requestId: randomUUID(), reviewToken: review.body.reviewToken, contract: lease,
    readings: [{ meterId: meter.id, currentReading: 6 }],
  };

  await prisma.$executeRaw`ALTER TABLE rooms ADD CONSTRAINT test_move_in_rollback CHECK ("roomNumber" <> 'MOVE-IN-ROLLBACK' OR status <> 'OCCUPIED')`;
  try {
    expect((await submit(data)).status).toBe(500);
  } finally {
    await prisma.$executeRaw`ALTER TABLE rooms DROP CONSTRAINT test_move_in_rollback`;
  }
  expect(await prisma.contract.count({ where: { roomId: room.id } })).toBe(0);
  expect(await prisma.bill.count()).toBe(0);
  expect(await prisma.prepayAccount.count({ where: { tenantId: tenant.id } })).toBe(0);
  expect(await prisma.meterReading.count({ where: { meterId: meter.id } })).toBe(0);
  expect(await prisma.moveInRequest.count()).toBe(0);
  expect(await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
    .toMatchObject({ status: 'VACANT', version: room.version });

  expect((await submit(data)).status).toBe(201);
  expect(await prisma.moveInRequest.count()).toBe(1);
  expect(await prisma.bill.count()).toBe(2);
});

it('reuses an existing confirmed lease, rental bill and prepay account', async () => {
  const { admin, tenant, room, lease, meter, preview, submit } = await prepare('MOVE-IN-EXISTING');
  const draft = await http(app).post('/contracts').set(admin).send(lease);
  expect(draft.status).toBe(201);
  expect((await http(app).post(`/contracts/${draft.body.id}/confirm`).set(admin)).status).toBe(201);
  const rent = await prisma.bill.findFirstOrThrow({ where: { contractId: draft.body.id, billType: 'RENT' } });
  const account = await prisma.prepayAccount.create({ data: { tenantId: tenant.id, roomId: room.id, balanceCache: 100 } });
  const review = await preview({ contractId: draft.body.id });
  expect(review.status).toBe(201);
  const data = {
    requestId: randomUUID(), reviewToken: review.body.reviewToken, contractId: draft.body.id,
    readings: [{ meterId: meter.id, currentReading: 0 }],
  };
  const completed = await submit(data);
  expect(completed.status, JSON.stringify(completed.body)).toBe(201);
  expect(completed.body.billIds).toContain(rent.id);
  expect(completed.body.prepayAccountId).toBe(account.id);
  expect(await prisma.prepayAccount.findUniqueOrThrow({ where: { id: account.id } }))
    .toMatchObject({ balanceCache: 100 });
  expect(await prisma.bill.count({ where: { contractId: draft.body.id } })).toBe(2);
  expect(await prisma.contract.count({ where: { roomId: room.id } })).toBe(1);
});
