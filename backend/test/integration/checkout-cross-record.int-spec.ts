import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogService } from '../../src/modules/audit/audit-log.service.js';
import type { INestApplication } from '@nestjs/common';
import { SchedulerDailyJobsService } from '../../src/modules/scheduler/scheduler-daily-jobs.service.js';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';
let app: INestApplication;
beforeAll(async () => { app = await createApp({ denyPayments: true }); });
afterAll(async () => { await app?.close(); await prisma.$disconnect(); });
beforeEach(async () => { await resetDatabase(); });
describe('跨退租单并发', () => {
  it.each([false, true])('两个真实入口创建的退租单同步完成仅允许一个（反序 %s）', async (reverse) => {
    const base = await seedBase(); const tenancy = await setupTenancy(app, base);
    await prisma.depositLedger.create({ data: { contractId: tenancy.contractId, roomId: tenancy.roomId, tenantId: tenancy.tenantId, amount: 3000, balance: 3000 } });
    const body = { contractId: tenancy.contractId, roomId: tenancy.roomId, checkoutDate: '2026-10-29', totalRefund: 3500, processedBy: 'synthetic', items: [{ itemType: 'DEPOSIT_REFUND', description: '押金', amount: 3000 }, { itemType: 'DEPOSIT_DEDUCTION', description: '扣款', amount: 500 }, { itemType: 'OTHER_REFUND', description: '合成', amount: 1000 }] };
    const one = await http(app).post('/checkout').set(auth(tenancy.adminToken)).send(body);
    const two = await http(app).post('/checkout').set(auth(tenancy.adminToken)).send(body);
    expect([one.status, two.status]).toEqual([201, 201]);
    let release!: () => void; let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; }); const barrier = new Promise<void>(resolve => { release = resolve; });
    const hold = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM checkout_records WHERE id IN (${one.body.id}, ${two.body.id}) FOR UPDATE`; locked(); await barrier; }, { timeout: 15000 });
    await ready;
    const request = (id: string) => http(app).patch(`/checkout/${id}`).set(auth(tenancy.adminToken)).send({ status: 'COMPLETED' });
    const ids = reverse ? [two.body.id, one.body.id] : [one.body.id, two.body.id];
    const pending = Promise.all(ids.map(request));
    let waiters = 0;
    for (let i = 0; i < 100; i++) { const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%checkout_records%'`; waiters = Number(rows[0].count); if (waiters >= 2) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    release(); await hold; expect(waiters).toBeGreaterThanOrEqual(2);
    const results = await pending;
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.checkoutRecord.count({ where: { contractId: tenancy.contractId, status: 'COMPLETED' } })).toBe(1);
    expect(await prisma.cleaningTask.count({ where: { roomId: tenancy.roomId } })).toBe(1);
    expect(await prisma.depositTransaction.count({ where: { ledger: { contractId: tenancy.contractId }, type: 'DEDUCT' } })).toBe(1);
    expect(await prisma.depositTransaction.count({ where: { ledger: { contractId: tenancy.contractId }, type: 'REFUND' } })).toBe(1);
    expect((await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: tenancy.contractId } })).balance).toBe(0);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: tenancy.contractId } })).status).toBe('TERMINATED');
    expect(await prisma.room.findUniqueOrThrow({ where: { id: tenancy.roomId } })).toMatchObject({ status: 'VACANT', cleanStatus: 'PENDING_CLEAN' });
    expect(await prisma.checkoutRecord.count({ where: { contractId: tenancy.contractId, status: 'COMPLETED', totalRefund: 3500 } })).toBe(1);
    const winner = results.find(r => r.status === 200)!;
    expect((await request(winner.body.id)).status).toBe(200);
    const loser = results.find(r => r.status === 409)!;
    const loserId = winner.body.id === one.body.id ? two.body.id : one.body.id;
    expect(loser.status).toBe(409); expect((await request(loserId)).status).toBe(409);
    if (!reverse) {
      const oldTask = await prisma.cleaningTask.findFirstOrThrow({ where: { roomId: tenancy.roomId } });
      expect((await http(app).post(`/cleaning/tasks/${oldTask.id}/start`).set(auth(tenancy.adminToken))).status).toBe(201);
      const old = await prisma.contract.findUniqueOrThrow({ where: { id: tenancy.contractId } });
      const next = await prisma.contract.create({ data: { buildingId: old.buildingId, roomId: old.roomId, tenantId: old.tenantId, contractNumber: 'LATER-CONTRACT', rentAmount: old.rentAmount, depositAmount: old.depositAmount, paymentCycle: old.paymentCycle, paymentDay: old.paymentDay, startDate: new Date('2026-10-01'), endDate: new Date('2027-10-01'), lateFeeRule: old.lateFeeRule as object } });
      expect((await http(app).patch(`/contracts/${next.id}`).set(auth(tenancy.adminToken)).send({ status: 'ACTIVE' })).status).toBe(409);
      expect((await app.get(SchedulerDailyJobsService).autoTransitionContracts()).activated).toBe(0);
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('DRAFT');
      expect((await http(app).post(`/cleaning/tasks/${oldTask.id}/complete`).set(auth(tenancy.adminToken)).send({})).status).toBe(201);
      expect((await http(app).patch(`/rooms/${tenancy.roomId}/clean`).set(auth(tenancy.adminToken)).send({})).status).toBe(200);
      expect((await prisma.cleaningTask.findUniqueOrThrow({ where: { id: oldTask.id } })).status).toBe('COMPLETED');
      expect((await http(app).patch(`/rooms/${tenancy.roomId}`).set(auth(tenancy.adminToken)).send({ status: 'RESERVED' })).status).toBe(200);
      expect((await http(app).patch(`/contracts/${next.id}`).set(auth(tenancy.adminToken)).send({ status: 'ACTIVE' })).status).toBe(200);
      await prisma.depositLedger.create({ data: { contractId: next.id, roomId: tenancy.roomId, tenantId: tenancy.tenantId, amount: 3000, balance: 3000 } });
      const later = await http(app).post('/checkout').set(auth(tenancy.adminToken)).send({ ...body, contractId: next.id });
      expect(later.status).toBe(201); expect((await request(later.body.id)).status).toBe(200);
      expect(await prisma.cleaningTask.count({ where: { roomId: tenancy.roomId } })).toBe(2);
    }
  }, 30000);
  it.each([[false, 'manual'], [true, 'manual'], [false, 'scheduler'], [true, 'scheduler']] as const)('退租与后续合同启用互斥（启用先 %s，方式 %s）', async (activationFirst, mode) => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    await prisma.contract.update({ where: { id: t.contractId }, data: { startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') } });
    await prisma.depositLedger.create({ data: { contractId: t.contractId, roomId: t.roomId, tenantId: t.tenantId, amount: 3000, balance: 3000 } });
    const previous = await prisma.contract.findUniqueOrThrow({ where: { id: t.contractId } });
    const next = await prisma.contract.create({ data: { buildingId: previous.buildingId, roomId: previous.roomId, tenantId: previous.tenantId, contractNumber: 'CROSS-NEXT', rentAmount: previous.rentAmount, depositAmount: previous.depositAmount, paymentCycle: previous.paymentCycle, paymentDay: previous.paymentDay, startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), lateFeeRule: previous.lateFeeRule as object, renewedFromId: previous.id } });
    const checkout = await http(app).post('/checkout').set(auth(t.adminToken)).send({ contractId: t.contractId, roomId: t.roomId, checkoutDate: '2026-10-29', totalRefund: 3500, processedBy: 'synthetic', items: [{ itemType: 'DEPOSIT_REFUND', description: '押金', amount: 3000 }, { itemType: 'DEPOSIT_DEDUCTION', description: '扣款', amount: 500 }, { itemType: 'OTHER_REFUND', description: '其他', amount: 1000 }] });
    expect(checkout.status).toBe(201);
    let release!: () => void; let locked!: () => void; const ready = new Promise<void>(resolve => { locked = resolve; }); const barrier = new Promise<void>(resolve => { release = resolve; });
    const hold = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${t.roomId} FOR UPDATE`; locked(); await barrier; }, { timeout: 15000 }); await ready;
    const checkoutRequest = () => http(app).patch(`/checkout/${checkout.body.id}`).set(auth(t.adminToken)).send({ status: 'COMPLETED' });
    const activateRequest = async () => mode === 'manual' ? await http(app).patch(`/contracts/${next.id}`).set(auth(t.adminToken)).send({ status: 'ACTIVE' }) : { status: (await app.get(SchedulerDailyJobsService).autoTransitionContracts()).activated ? 200 : 409 };
    const waitLocks = async (target: number) => { for (let i = 0; i < 100; i++) { const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%rooms%'`; if (Number(rows[0].count) >= target) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('room lock barrier not reached'); };
    const firstPromise = activationFirst ? activateRequest() : checkoutRequest().then(r => r); await waitLocks(1);
    const secondPromise = activationFirst ? checkoutRequest().then(r => r) : activateRequest(); await waitLocks(2);
    release(); await hold;
    const [a, b] = await Promise.all([firstPromise, secondPromise]); expect([a.status, b.status]).toEqual([200, 409]);
    const room = await prisma.room.findUniqueOrThrow({ where: { id: t.roomId } }); const old = await prisma.contract.findUniqueOrThrow({ where: { id: t.contractId } }); const current = await prisma.contract.findUniqueOrThrow({ where: { id: next.id } });
    if (activationFirst) { expect((await prisma.checkoutRecord.findUniqueOrThrow({ where: { id: checkout.body.id } })).status).toBe('DRAFT'); expect(await prisma.depositTransaction.count({ where: { ledger: { contractId: t.contractId } } })).toBe(0); expect(current.status).toBe('ACTIVE'); expect(old.status).toBe('RENEWED'); expect(room.status).toBe('OCCUPIED'); expect(await prisma.cleaningTask.count({ where: { roomId: t.roomId } })).toBe(0); expect((await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: t.contractId } })).balance).toBe(3000); }
    else { expect(await prisma.checkoutRecord.findUniqueOrThrow({ where: { id: checkout.body.id } })).toMatchObject({ status: 'COMPLETED', totalRefund: 3500 }); expect(await prisma.depositTransaction.count({ where: { ledger: { contractId: t.contractId }, type: { in: ['DEDUCT', 'REFUND'] } } })).toBe(2); expect(current.status).toBe('DRAFT'); expect(old.status).toBe('TERMINATED'); expect(room).toMatchObject({ status: 'VACANT', cleanStatus: 'PENDING_CLEAN' }); expect(await prisma.cleaningTask.count({ where: { roomId: t.roomId } })).toBe(1); expect((await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: t.contractId } })).balance).toBe(0); }
  }, 30000);

  it('等式失败回滚后另一退租单仍可完成', async () => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    await prisma.depositLedger.create({ data: { contractId: t.contractId, tenantId: t.tenantId, roomId: t.roomId, amount: 3000, balance: 3000 } });
    const body = { contractId: t.contractId, roomId: t.roomId, checkoutDate: '2026-10-29', totalRefund: 3000, processedBy: 'synthetic', items: [{ itemType: 'DEPOSIT_REFUND', description: '押金', amount: 3000 }] };
    const bad = await http(app).post('/checkout').set(auth(t.adminToken)).send({ ...body, totalRefund: 1 });
    const good = await http(app).post('/checkout').set(auth(t.adminToken)).send(body);
    expect([bad.status, good.status]).toEqual([201, 201]);
    expect((await http(app).patch(`/checkout/${bad.body.id}`).set(auth(t.adminToken)).send({ status: 'COMPLETED' })).status).toBe(400);
    expect((await prisma.checkoutRecord.findUniqueOrThrow({ where: { id: bad.body.id } })).status).toBe('DRAFT');
    expect((await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: t.contractId } })).balance).toBe(3000);
    expect(await prisma.cleaningTask.count({ where: { roomId: t.roomId } })).toBe(0);
    expect((await http(app).patch(`/checkout/${good.body.id}`).set(auth(t.adminToken)).send({ status: 'COMPLETED' })).status).toBe(200);
  });

  it('结算后审计失败会回滚押金、合同、房态及工单，可重试', async () => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    await prisma.depositLedger.create({ data: { contractId: t.contractId, tenantId: t.tenantId, roomId: t.roomId, amount: 3000, balance: 3000 } });
    const body = { contractId: t.contractId, roomId: t.roomId, checkoutDate: '2026-10-29', totalRefund: 3000, processedBy: 'synthetic', items: [{ itemType: 'DEPOSIT_REFUND', description: '押金', amount: 3000 }] };
    const created = await http(app).post('/checkout').set(auth(t.adminToken)).send(body); expect(created.status).toBe(201);
    const audit = vi.spyOn(app.get(AuditLogService), 'recordEvent').mockRejectedValueOnce(new Error('synthetic audit failure'));
    const complete = () => http(app).patch(`/checkout/${created.body.id}`).set(auth(t.adminToken)).send({ status: 'COMPLETED' });
    expect((await complete()).status).toBe(500);
    expect((await prisma.checkoutRecord.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('DRAFT');
    expect((await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: t.contractId } })).balance).toBe(3000);
    expect(await prisma.depositTransaction.count({ where: { ledger: { contractId: t.contractId } } })).toBe(0);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: t.contractId } })).status).toBe('ACTIVE');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: t.roomId } })).status).toBe('OCCUPIED');
    expect(await prisma.cleaningTask.count({ where: { roomId: t.roomId } })).toBe(0);
    audit.mockRestore(); expect((await complete()).status).toBe(200);
  });

  it.each([[false, 'deduct'], [true, 'deduct'], [false, 'refund'], [true, 'refund']] as const)('独立押金扣退与退租结算同台账互斥（扣退先 %s，%s）', async (deductFirst, action) => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    await prisma.depositLedger.create({ data: { contractId: t.contractId, tenantId: t.tenantId, roomId: t.roomId, amount: 3000, balance: 3000 } });
    const created = await http(app).post('/checkout').set(auth(t.adminToken)).send({ contractId: t.contractId, roomId: t.roomId, checkoutDate: '2026-10-29', totalRefund: 3000, processedBy: 'synthetic', items: [{ itemType: 'DEPOSIT_REFUND', description: '押金', amount: 3000 }] }); expect(created.status).toBe(201);
    let release!: () => void; let locked!: () => void; const ready = new Promise<void>(resolve => { locked = resolve; }); const barrier = new Promise<void>(resolve => { release = resolve; });
    const hold = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM deposit_ledgers WHERE "contractId" = ${t.contractId} FOR UPDATE`; locked(); await barrier; }, { timeout: 15000 }); await ready;
    const deduct = () => http(app).post(`/deposits/${t.contractId}/${action}`).set(auth(t.adminToken)).send({ amount: 500, reason: '合成扣除' }).then(r => r);
    const checkout = () => http(app).patch(`/checkout/${created.body.id}`).set(auth(t.adminToken)).send({ status: 'COMPLETED' }).then(r => r);
    const waitLocks = async (target: number) => { for (let i = 0; i < 100; i++) { const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%deposit_ledgers%'`; if (Number(rows[0].count) >= target) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('ledger barrier not reached'); };
    const first = deductFirst ? deduct() : checkout(); await waitLocks(1); const second = deductFirst ? checkout() : deduct(); await waitLocks(2); release(); await hold;
    const [a, b] = await Promise.all([first, second]); expect(a.status).toBe(deductFirst ? 201 : 200); expect(b.status).toBe(400);
    const ledger = await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: t.contractId }, include: { transactions: true } });
    expect(ledger.balance).toBe(deductFirst ? 2500 : 0);
    expect(ledger.transactions.reduce((sum, row) => sum + row.amount, 0)).toBe(deductFirst ? -500 : -3000);
    expect((await prisma.checkoutRecord.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(deductFirst ? 'DRAFT' : 'COMPLETED');
    expect(await prisma.cleaningTask.count({ where: { roomId: t.roomId } })).toBe(deductFirst ? 0 : 1);
  }, 30000);

  it.each([true, false])('续约押金转移与退租结算互斥（转移先 %s）', async (transferFirst) => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    const old = await prisma.contract.findUniqueOrThrow({ where: { id: t.contractId } });
    const next = await prisma.contract.create({ data: { buildingId: old.buildingId, roomId: old.roomId, tenantId: old.tenantId, contractNumber: 'TRANSFER-NEXT', rentAmount: old.rentAmount, depositAmount: old.depositAmount, paymentCycle: old.paymentCycle, paymentDay: old.paymentDay, startDate: new Date('2026-11-01'), endDate: new Date('2027-11-01'), lateFeeRule: old.lateFeeRule as object, renewedFromId: old.id } });
    await prisma.depositLedger.create({ data: { contractId: old.id, tenantId: t.tenantId, roomId: t.roomId, amount: 3000, balance: 3000 } });
    await prisma.depositLedger.create({ data: { contractId: next.id, tenantId: t.tenantId, roomId: t.roomId, amount: 3000, balance: 0 } });
    const created = await http(app).post('/checkout').set(auth(t.adminToken)).send({ contractId: old.id, roomId: t.roomId, checkoutDate: '2026-10-29', totalRefund: 3000, processedBy: 'synthetic', items: [{ itemType: 'DEPOSIT_REFUND', description: '押金', amount: 3000 }] }); expect(created.status).toBe(201);
    let release!: () => void; let locked!: () => void; const ready = new Promise<void>(resolve => { locked = resolve; }); const barrier = new Promise<void>(resolve => { release = resolve; });
    const hold = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM deposit_ledgers WHERE "contractId" = ${old.id} FOR UPDATE`; locked(); await barrier; }, { timeout: 15000 }); await ready;
    const transfer = () => http(app).post(`/deposits/${old.id}/transfer`).set(auth(t.adminToken)).send({ toContractId: next.id }).then(r => r);
    const checkout = () => http(app).patch(`/checkout/${created.body.id}`).set(auth(t.adminToken)).send({ status: 'COMPLETED' }).then(r => r);
    const waitLocks = async (target: number) => { for (let i = 0; i < 100; i++) { const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%deposit_ledgers%'`; if (Number(rows[0].count) >= target) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('ledger barrier not reached'); };
    const first = transferFirst ? transfer() : checkout(); await waitLocks(1); const second = transferFirst ? checkout() : transfer(); await waitLocks(2); release(); await hold;
    const [a, b] = await Promise.all([first, second]); expect(a.status).toBe(transferFirst ? 201 : 200); expect(b.status).toBe(400);
    const source = await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: old.id }, include: { transactions: true } });
    const target = await prisma.depositLedger.findUniqueOrThrow({ where: { contractId: next.id }, include: { transactions: true } });
    expect(source.balance).toBe(0); expect(target.balance).toBe(transferFirst ? 3000 : 0);
    expect(source.transactions.map(row => [row.type, row.amount])).toEqual([[transferFirst ? 'TRANSFER' : 'REFUND', -3000]]);
    expect(target.transactions.map(row => [row.type, row.amount])).toEqual(transferFirst ? [['TRANSFER', 3000]] : []);
    expect((await prisma.checkoutRecord.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(transferFirst ? 'DRAFT' : 'COMPLETED');
    expect(await prisma.cleaningTask.count({ where: { roomId: t.roomId } })).toBe(transferFirst ? 0 : 1);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(transferFirst ? 'ACTIVE' : 'TERMINATED');
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('DRAFT');
  }, 30000);

  it('同房已有活动保洁任务时不重复建单', async () => {
    const base = await seedBase(); const t = await setupTenancy(app, base);
    await prisma.depositLedger.create({ data: { contractId: t.contractId, tenantId: t.tenantId, roomId: t.roomId, amount: 3000, balance: 3000 } });
    const task = await http(app).post('/cleaning/tasks').set(auth(t.adminToken)).send({ roomId: t.roomId, type: 'CHECKOUT' }); expect(task.status).toBe(201);
    const created = await http(app).post('/checkout').set(auth(t.adminToken)).send({ contractId: t.contractId, roomId: t.roomId, checkoutDate: '2026-10-29', totalRefund: 3000, processedBy: 'synthetic', items: [{ itemType: 'DEPOSIT_REFUND', description: '押金', amount: 3000 }] }); expect(created.status).toBe(201);
    expect((await http(app).patch(`/checkout/${created.body.id}`).set(auth(t.adminToken)).send({ status: 'COMPLETED' })).status).toBe(200);
    const tasks = await prisma.cleaningTask.findMany({ where: { roomId: t.roomId } }); expect(tasks).toHaveLength(1); expect(tasks[0].id).toBe(task.body.id);
  });

});
