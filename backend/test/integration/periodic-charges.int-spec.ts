import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { PeriodicChargesService } from '../../src/modules/periodic-charges/periodic-charges.service.js';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';

let app: INestApplication;
async function boot() {
  const instance = await createApp();
  instance.get(SchedulerRegistry).deleteCronJob('periodic-charge-batches');
  return instance;
}
beforeEach(async () => {
  await resetDatabase();
  app = await boot();
});
afterEach(async () => { await app?.close(); });

async function fixture() {
  const base = await seedBase();
  const admin = auth(await login(app, base.adminEmail, base.adminPassword));
  const cleaner = auth(await login(app, base.cleanerEmail, base.cleanerPassword));
  const clock = app.get(BusinessClock);
  const cutoff = clock.addDays(clock.startOfMonth(clock.todayUtc()), -2);
  const stamp = (seconds: number) => new Date(cutoff.getTime() - seconds * 1000).toISOString();
  async function subject(number: string, withAccount = true) {
    const user = await prisma.user.create({ data: { role: 'TENANT', email: `charge-${number}@example.com` } });
    const tenant = await prisma.tenant.create({ data: { name: number, phone: '138000000' + number, userId: user.id } });
    const room = await prisma.room.create({ data: {
      buildingId: base.buildingId, roomNumber: number, floor: 1, roomType: 'SINGLE', status: 'OCCUPIED',
    } });
    const lease = await prisma.contract.create({ data: {
      buildingId: base.buildingId, roomId: room.id, tenantId: tenant.id, contractNumber: `C-${number}`,
      status: 'ACTIVE', startDate: clock.startOfMonth(cutoff), endDate: clock.addDays(cutoff, 20),
      rentAmount: 10000, depositAmount: 0, paymentCycle: 'MONTHLY', paymentDay: 1, lateFeeRule: {},
    } });
    const meter = await prisma.meter.create({ data: {
      buildingId: base.buildingId, roomId: room.id, meterType: 'ELECTRICITY', meterNumber: `M-${number}`,
      unitPrice: 100, priceEffectiveDate: clock.startOfMonth(cutoff),
    } });
    const account = withAccount ? await prisma.prepayAccount.create({
      data: { tenantId: tenant.id, roomId: room.id, balanceCache: 5000 },
    }) : null;
    return { tenant, room, lease, meter, account };
  }
  const request = () => http(app);
  const collect = (readings: { meterId: string; currentReading: number; readingTime: string; autoSettle?: boolean }[]) =>
    request().post('/periodic-charges/collect').set(admin).send({ readings });
  const preview = () => request().post('/periodic-charges/preview').set(admin)
    .send({ buildingId: base.buildingId, cutoff: cutoff.toISOString() });
  const get = (id: string) => request().get(`/periodic-charges/${id}`).set(admin);
  const action = (id: string, name: string, version?: number) => request().post(`/periodic-charges/${id}/${name}`).set(admin)
    .send(version === undefined ? {} : { version });
  return { admin, cleaner, subject, stamp, collect, preview, get, action, request };
}

it('persists mixed results after restart and retries only repaired charges and notices', async () => {
  const f = await fixture();
  const paid = await f.subject('01');
  const blocked = await f.subject('02', false);
  const failed = await f.subject('03');
  const unchanged = await f.subject('04');
  const targets = [paid, blocked, failed, unchanged];
  const initial = await f.collect(targets.map(({ meter }) => ({ meterId: meter.id, currentReading: 100, readingTime: f.stamp(100) })));
  expect(initial.status).toBe(201);
  const collected = await f.collect([
    { meterId: paid.meter.id, currentReading: 103, readingTime: f.stamp(30), autoSettle: true },
    { meterId: blocked.meter.id, currentReading: 104, readingTime: f.stamp(30), autoSettle: true },
    { meterId: failed.meter.id, currentReading: 109, readingTime: f.stamp(30), autoSettle: true },
  ]);
  expect(collected.body.successCount).toBe(3);
  expect(await prisma.prepayTransaction.count()).toBe(0);
  expect(await prisma.bill.count()).toBe(0);
  expect((await f.request().get('/periodic-charges').set(f.cleaner)).status).toBe(403);

  const review = await f.preview();
  expect(review.status, JSON.stringify(review.body)).toBe(201);
  const batch = review.body;
  const row = (data: typeof batch, meterId: string) =>
    data.items.find((item: { targetId: string }) => item.targetId === meterId);
  expect(row(batch, blocked.meter.id)).toMatchObject({ state: 'BLOCKED', result: { reasonCode: 'MISSING_PREPAY_ACCOUNT' } });
  expect(row(batch, unchanged.meter.id)).toMatchObject({ state: 'NO_CHANGE', attempts: 0 });
  expect(await prisma.bill.count()).toBe(0);
  expect(await prisma.prepayTransaction.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
  const approval = await f.action(batch.id, 'confirm', batch.version);
  expect(approval.status).toBe(201);
  expect((await f.action(batch.id, 'confirm', batch.version)).status).toBe(409);

  // The process is restarted with only committed queue rows to find.
  await app.close();
  app = await boot();
  expect((await f.get(batch.id)).body.items.some((item: { state: string }) => item.state === 'QUEUED')).toBe(true);
  expect((await f.request().get('/periodic-charges').set(f.admin)).body).toMatchObject([{ id: batch.id }]);

  await prisma.$executeRaw`ALTER TABLE prepay_transactions ADD CONSTRAINT periodic_charge_rollback CHECK (amount <> -900)`;
  const worker = app.get(PeriodicChargesService);
  try {
    // Two worker callers can safely claim distinct items.
    const run = async () => { while (await worker.processNext()) { /* drain durable items */ } };
    await Promise.all([run(), run()]);
  } finally {
    await prisma.$executeRaw`ALTER TABLE prepay_transactions DROP CONSTRAINT periodic_charge_rollback`;
  }
  const partial = (await f.get(batch.id)).body;
  expect(row(partial, paid.meter.id)).toMatchObject({ state: 'SETTLED', attempts: 1, result: { amount: 300 } });
  expect(row(partial, blocked.meter.id)).toMatchObject({ state: 'BLOCKED', attempts: 0 });
  expect(row(partial, failed.meter.id)).toMatchObject({ state: 'FAILED', attempts: 1, result: { reasonCode: 'CHARGE_FAILED' } });
  expect(await prisma.prepayAccount.findUnique({ where: { id: failed.account!.id } })).toMatchObject({ balanceCache: 5000 });
  expect(await prisma.meterReading.count({ where: { meterId: failed.meter.id, settledAt: { not: null } } })).toBe(1);
  expect(await prisma.bill.count({ where: { billType: 'RENT' } })).toBe(4);

  const notices = vi.spyOn(app.get(NotificationsService), 'create').mockRejectedValueOnce(new Error('test notification interruption'));
  await worker.deliverPending();
  notices.mockRestore();
  expect(await prisma.periodicChargeItem.count({ where: { batchId: batch.id, notificationState: 'FAILED' } })).toBe(1);
  expect((await f.action(batch.id, 'notifications/retry')).status).toBe(201);
  await worker.deliverPending();
  expect(await prisma.notification.count()).toBe(5);
  expect(await prisma.bill.count({ where: { billType: 'RENT' } })).toBe(4);

  const stillBlocked = await f.action(batch.id, 'recheck', partial.version);
  expect(row(stillBlocked.body, blocked.meter.id)).toMatchObject({ state: 'BLOCKED', attempts: 0 });
  await prisma.prepayAccount.create({
    data: { tenantId: blocked.tenant.id, roomId: blocked.room.id, balanceCache: 5000 },
  });
  const retry = await f.action(batch.id, 'recheck', stillBlocked.body.version);
  expect(retry.body.items.filter((item: { state: string }) => item.state === 'READY')).toHaveLength(2);
  expect((await f.action(batch.id, 'confirm', retry.body.version)).status).toBe(201);

  await app.close();
  app = await boot();
  await app.get(PeriodicChargesService).drain();
  const done = (await f.get(batch.id)).body;
  expect(row(done, paid.meter.id)).toMatchObject({ state: 'SETTLED', attempts: 1, result: row(partial, paid.meter.id).result });
  expect(row(done, unchanged.meter.id)).toMatchObject({ state: 'NO_CHANGE', attempts: 0 });
  expect(row(done, blocked.meter.id)).toMatchObject({ state: 'SETTLED', attempts: 1, result: { amount: 400 } });
  expect(row(done, failed.meter.id)).toMatchObject({ state: 'SETTLED', attempts: 2, result: { amount: 900 } });
  expect(await prisma.bill.count({ where: { billType: 'RENT' } })).toBe(4);
  expect(await prisma.prepayTransaction.count()).toBe(3);
  expect((await prisma.prepayTransaction.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(-1600);
  expect(await prisma.notification.count()).toBe(7);
});

it('blocks changes to a previewed interval until the new amount is reviewed and confirmed', async () => {
  const f = await fixture();
  const { meter } = await f.subject('09');
  await f.collect([{ meterId: meter.id, currentReading: 100, readingTime: f.stamp(100) }]);
  await f.collect([{ meterId: meter.id, currentReading: 103, readingTime: f.stamp(60) }]);
  const batch = (await f.preview()).body;
  await f.collect([{ meterId: meter.id, currentReading: 105, readingTime: f.stamp(30) }]);
  await f.action(batch.id, 'confirm', batch.version);
  await app.get(PeriodicChargesService).drain();
  const stale = (await f.get(batch.id)).body;
  expect(stale.items.find((item: { targetId: string }) => item.targetId === meter.id))
    .toMatchObject({ state: 'BLOCKED', result: { reasonCode: 'STALE_REVIEW' } });
  expect(await prisma.prepayTransaction.count()).toBe(0);
  const refresh = (await f.action(batch.id, 'recheck', stale.version)).body;
  expect(refresh.items.find((item: { targetId: string }) => item.targetId === meter.id))
    .toMatchObject({ state: 'READY', review: { amount: 500 } });
  await f.action(batch.id, 'confirm', refresh.version);
  await app.get(PeriodicChargesService).drain();
  expect(await prisma.prepayTransaction.count()).toBe(1);
  expect((await prisma.prepayTransaction.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(-500);
  const duplicate = (await f.preview()).body;
  expect(duplicate.items.map((item: { state: string }) => item.state)).toEqual(['NO_CHANGE', 'NO_CHANGE']);
  expect((await f.action(duplicate.id, 'confirm', duplicate.version)).status).toBe(409);
  expect(await prisma.bill.count()).toBe(1);
  expect(await prisma.prepayTransaction.count()).toBe(1);
});
