import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';
import { SchedulerDailyJobsService } from '../../src/modules/scheduler/scheduler-daily-jobs.service.js';

/** FIN-04 / T272：逾期解耦、每日滞纳金应计与筛选（真实 DB） */
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

async function createOverdueBill(adminToken: string, contractId: string) {
  const response = await http(app)
    .post('/bills')
    .set(auth(adminToken))
    .send({
      contractId,
      billType: 'OTHER',
      period: '2099-OVERDUE',
      amount: 100000,
      dueDate: '2026-01-01',
      snapshot: {},
    });
  expect(response.status).toBe(201);
  // 固定日额 100 分/天，便于核对 accrual
  await prisma.contract.update({
    where: { id: contractId },
    data: { lateFeeRule: { fixedDaily: 100 } },
  });
  return response.body.id as string;
}

describe('账单逾期与滞纳金（FIN-04）', () => {
  it('逾期不覆盖缴付进度：isOverdue/overdueDays 独立，重复执行只产生一条当日 accrual', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const billId = await createOverdueBill(tenancy.adminToken, tenancy.contractId);

    const scheduler = app.get(SchedulerDailyJobsService);
    const first = await scheduler.checkOverdueBills();
    const second = await scheduler.checkOverdueBills();

    expect(first.overdue).toBeGreaterThanOrEqual(1);
    expect(second.overdue).toBeGreaterThanOrEqual(1);

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.status).toBe('PENDING');
    expect(bill.isOverdue).toBe(true);
    expect(bill.overdueDays).toBeGreaterThan(0);

    const accruals = await prisma.lateFeeAccrual.findMany({ where: { billId } });
    expect(accruals).toHaveLength(1);
    expect(accruals[0].amount).toBe(100);

    const suggestion = await prisma.lateFee.findFirst({
      where: { billId, confirmedAmount: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(suggestion?.suggestedAmount).toBe(100 * bill.overdueDays);
  });

  it('overdue=true 与兼容的 status=OVERDUE 都能筛出逾期未缴清账单', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const billId = await createOverdueBill(tenancy.adminToken, tenancy.contractId);

    await app.get(SchedulerDailyJobsService).checkOverdueBills();

    const filtered = await http(app)
      .get('/bills?overdue=true')
      .set(auth(tenancy.adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.map((row: { id: string }) => row.id)).toContain(billId);

    const legacy = await http(app)
      .get('/bills?status=OVERDUE')
      .set(auth(tenancy.adminToken));
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.map((row: { id: string }) => row.id)).toContain(billId);
    expect(legacy.body.data.every((row: { status: string }) => row.status !== 'OVERDUE')).toBe(true);

    const pendingTab = await http(app)
      .get('/bills?status=PENDING')
      .set(auth(tenancy.adminToken));
    expect(pendingTab.body.data.map((row: { id: string }) => row.id)).toContain(billId);
  });

  it('部分收款后仍是 PARTIAL + isOverdue，本金付清后 PAID 并清除逾期标记', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    const billId = await createOverdueBill(tenancy.adminToken, tenancy.contractId);

    await app.get(SchedulerDailyJobsService).checkOverdueBills();

    const partial = await http(app)
      .post(`/bills/${billId}/payments`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 40000, paymentMethod: 'CASH' });
    expect(partial.status).toBe(201);

    const afterPartial = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(afterPartial.status).toBe('PARTIAL');
    expect(afterPartial.isOverdue).toBe(true);

    // 本金付清 → PAID，逾期标记清除
    const rest = await http(app)
      .post(`/bills/${billId}/payments`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 60000, paymentMethod: 'CASH' });
    expect(rest.status).toBe(201);
    const afterRest = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(afterRest.paidAmount).toBe(100000);
    expect(afterRest.status).toBe('PAID');
    expect(afterRest.isOverdue).toBe(false);
    expect(afterRest.overdueDays).toBe(0);
  });
});
