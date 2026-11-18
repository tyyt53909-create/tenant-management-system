import { expect, it, vi } from 'vitest';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';
import { SchedulerDailyJobsService } from '../../src/modules/scheduler/scheduler-daily-jobs.service.js';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';

it('requires administrator confirmation and a due lease before activation, and keeps check-in separate', async () => {
  await resetDatabase();
  const app = await createApp();
  try {
    const base = await seedBase();
    const admin = auth(await login(app, base.adminEmail, base.adminPassword));
    const cleaner = auth(await login(app, base.cleanerEmail, base.cleanerPassword));
    const clock = app.get(BusinessClock);
    const today = clock.todayUtc();
    const date = (days: number) => clock.addDays(today, days).toISOString().slice(0, 10);
    const tenant = await prisma.tenant.create({ data: { name: '入住测试', phone: '13900003310' } });
    const prepare = async (number: string, offset: number, status: 'VACANT' | 'RESERVED' = 'RESERVED') => {
      const room = await prisma.room.create({ data: {
        buildingId: base.buildingId, roomNumber: number, floor: 1, roomType: 'SINGLE', status,
      } });
      const draft = await http(app).post('/contracts').set(admin).send({
        buildingId: base.buildingId, roomId: room.id, tenantId: tenant.id,
        rentAmount: 300000, depositAmount: 500000, paymentCycle: 'MONTHLY', paymentDay: 1,
        startDate: date(offset), endDate: date(365),
      });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      return { room, id: draft.body.id as string, updatedAt: draft.body.updatedAt as string };
    };
    const past = await prepare('PAST', -1);
    const future = await prepare('FUTURE', 1);
    const vacant = await prepare('VACANT', -1, 'VACANT');
    const withdrawn = await prepare('WITHDRAWN', 2);
    const stale = await prepare('STALE', 2);
    const racing = await prepare('RACING', -1);
    const confirm = (lease: typeof past) => http(app).post(`/contracts/${lease.id}/confirm`).set(admin)
      .send({ expectedUpdatedAt: lease.updatedAt });
    const checkIn = (room: typeof past.room) => http(app).patch(`/rooms/${room.id}/status`).set(admin)
      .send({ status: 'OCCUPIED', version: room.version });
    const scheduler = app.get(SchedulerDailyJobsService);

    expect((await scheduler.autoTransitionContracts()).activated).toBe(0);
    expect((await http(app).patch(`/contracts/${past.id}`).set(admin).send({ status: 'ACTIVE' })).status).toBe(409);
    expect((await http(app).post(`/contracts/${past.id}/confirm`).set(cleaner)).status).toBe(403);
    expect((await checkIn(past.room)).status).toBe(400);

    const [first, replay] = await Promise.all([confirm(past), confirm(past)]);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'ACTIVE', leaseConfirmedBy: base.adminId });
    expect(replay.body.leaseConfirmedAt).toBe(first.body.leaseConfirmedAt);
    expect(await prisma.bill.count({ where: { contractId: past.id, billType: 'RENT' } })).toBeGreaterThan(0);
    const bills = await prisma.bill.findMany({ where: { contractId: past.id, billType: 'RENT' } });
    expect(new Set(bills.map((bill) => bill.period)).size).toBe(bills.length);
    expect(await prisma.room.findUnique({ where: { id: past.room.id } })).toMatchObject({ status: 'RESERVED' });
    expect((await checkIn(past.room)).status).toBe(200);

    expect((await checkIn(vacant.room)).status).toBe(400);
    expect((await confirm(vacant)).body.status).toBe('ACTIVE');
    expect((await checkIn(vacant.room)).body.status).toBe('OCCUPIED');

    const updateTerms = await http(app).patch(`/contracts/${stale.id}`).set(admin).send({ rentAmount: 350000 });
    expect(updateTerms.status).toBe(200);
    expect((await confirm(stale)).status).toBe(409);
    expect((await confirm({ ...stale, updatedAt: updateTerms.body.updatedAt })).status).toBe(201);

    const confirmation = await confirm(withdrawn);
    expect(confirmation.body.status).toBe('DRAFT');
    const withdrawal = await http(app).patch(`/contracts/${withdrawn.id}`).set(admin).send({ withdrawConfirmation: true });
    expect(withdrawal.status).toBe(200);
    expect(withdrawal.body).toMatchObject({ status: 'TERMINATED', leaseConfirmedAt: confirmation.body.leaseConfirmedAt });
    expect(await prisma.room.findUnique({ where: { id: withdrawn.room.id } })).toMatchObject({ status: 'VACANT' });

    const waitForLock = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await prisma.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FROM rooms%' AND query LIKE '%FOR UPDATE%'
        `;
        if (waiting.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('入住请求没有等待房间锁');
    };
    expect((await confirm(racing)).body.status).toBe('ACTIVE');
    const lateWithdrawal = await http(app).patch(`/contracts/${racing.id}`).set(admin).send({ withdrawConfirmation: true });
    expect(lateWithdrawal.status).toBe(409);
    let pendingCheckIn: PromiseLike<{ status: number }> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${racing.room.id} FOR UPDATE`;
      pendingCheckIn = checkIn(racing.room).then((response) => response);
      await waitForLock();
      await tx.contract.update({ where: { id: racing.id }, data: { status: 'TERMINATED' } });
    });
    expect((await pendingCheckIn)?.status).toBe(400);
    expect(await prisma.room.findUnique({ where: { id: racing.room.id } })).toMatchObject({ status: 'RESERVED' });

    expect((await confirm(future)).body).toMatchObject({ status: 'DRAFT', leaseConfirmedBy: base.adminId });
    expect((await scheduler.autoTransitionContracts()).activated).toBe(0);
    expect(await prisma.bill.count({ where: { contractId: future.id } })).toBe(0);
    const advanced = vi.spyOn(clock, 'now').mockReturnValue(clock.addDays(today, 1));
    try {
      expect((await scheduler.autoTransitionContracts()).activated).toBe(1);
      expect((await scheduler.autoTransitionContracts()).activated).toBe(0);
      expect(await prisma.contract.findUnique({ where: { id: future.id } })).toMatchObject({ status: 'ACTIVE' });
      expect(await prisma.room.findUnique({ where: { id: future.room.id } })).toMatchObject({ status: 'RESERVED' });
    } finally {
      advanced.mockRestore();
    }
  } finally {
    await app.close();
  }
});
