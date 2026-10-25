import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { SchedulerMonthlyBillsService } from '../../src/modules/scheduler/scheduler-monthly-bills.service.js';
import { createApp, prisma, resetDatabase, seedBase, setupTenancy } from './harness.js';

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

describe('租金按月累加', () => {
  it('季付完整首期是 3 倍月租金，重跑不重复', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    await prisma.contract.update({
      where: { id: tenancy.contractId },
      data: {
        rentAmount: 300_000,
        paymentCycle: 'QUARTERLY',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-12-31T00:00:00Z'),
        status: 'ACTIVE',
      },
    });

    const billing = app.get(SchedulerMonthlyBillsService);
    await billing.generateMonthlyBills(new Date('2026-01-15T04:00:00Z'));
    await billing.generateMonthlyBills(new Date('2026-01-31T16:30:00Z'));

    const bills = await prisma.bill.findMany({
      where: { contractId: tenancy.contractId, billType: 'RENT', period: '2026-01' },
    });
    expect(bills).toHaveLength(1);
    expect(bills[0]?.amount).toBe(900_000);
  });

  it('平年 2 月 15–28 日是 1500 元', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);
    await prisma.contract.update({
      where: { id: tenancy.contractId },
      data: {
        rentAmount: 300_000,
        paymentCycle: 'MONTHLY',
        startDate: new Date('2026-02-15T00:00:00Z'),
        endDate: new Date('2026-02-28T00:00:00Z'),
        status: 'ACTIVE',
      },
    });

    await app.get(SchedulerMonthlyBillsService).generateMonthlyBills(new Date('2026-02-15T02:00:00Z'));
    const bill = await prisma.bill.findFirst({
      where: { contractId: tenancy.contractId, billType: 'RENT', period: '2026-02' },
    });
    expect(bill?.amount).toBe(150_000);
  });
});
