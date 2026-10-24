import { Test } from '@nestjs/testing';
import { SchedulerMonthlyBillsService } from './scheduler-monthly-bills.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BillsService } from '../bills/bills.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('SchedulerMonthlyBillsService', () => {
  let service: SchedulerMonthlyBillsService;
  let prisma: any;
  let bills: any;
  const contract = (paymentCycle: string, startDate = '2026-01-01') => ({
    id: `c-${paymentCycle}`, contractNumber: 'C-1', paymentCycle, startDate: new Date(`${startDate}T00:00:00Z`),
    endDate: new Date('2027-12-31T00:00:00Z'), rentAmount: 90000, paymentDay: 5,
    tenant: { userId: null },
  });

  beforeEach(async () => {
    prisma = { contract: { findMany: vi.fn().mockResolvedValue([]) }, bill: { findFirst: vi.fn().mockResolvedValue(null) } };
    bills = { create: vi.fn().mockResolvedValue({ id: 'bill-1', alreadyExists: false }) };
    const module = await Test.createTestingModule({ providers: [
      SchedulerMonthlyBillsService,
      { provide: PrismaService, useValue: prisma },
      { provide: BillsService, useValue: bills },
      { provide: NotificationsService, useValue: { create: vi.fn() } },
    ] }).compile();
    service = module.get(SchedulerMonthlyBillsService);
  });

  it('月付每月出账一次', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('MONTHLY')]);
    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    expect(bills.create).toHaveBeenCalledTimes(1);
    expect(bills.create.mock.calls[0][0]).toMatchObject({ period: '2026-02', amount: 90000 });
  });

  it('季付仅周期起始月出全期租金账单', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('QUARTERLY')]);
    await service.generateMonthlyBills(new Date('2026-05-15T12:00:00Z'));
    expect(bills.create).not.toHaveBeenCalled();
    await service.generateMonthlyBills(new Date('2026-01-15T12:00:00Z'));
    expect(bills.create).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-01', amount: 90000 }));
  });

  it.each(['SEMI_ANNUAL', 'ANNUAL'])('%s 周期起始月出账', async (cycle) => {
    prisma.contract.findMany.mockResolvedValue([contract(cycle)]);
    await service.generateMonthlyBills(new Date('2026-01-15T12:00:00Z'));
    expect(bills.create).toHaveBeenCalledTimes(1);
  });

  it('首期月中开始按实际周期日数折算', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('MONTHLY', '2026-02-15')]);
    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    const input = bills.create.mock.calls[0][0];
    expect(input.amount).toBeGreaterThan(0);
    expect(input.amount).toBeLessThan(90000);
    expect(input.snapshot).toMatchObject({ cycle: 'MONTHLY', periodStart: '2026-02-01', periodEnd: '2026-02-28', proratedDays: 14 });
  });

  it('季付以合同起始月为锚点：2 月起的合同在 2/5/8/11 月出账', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('QUARTERLY', '2026-02-15')]);

    await service.generateMonthlyBills(new Date('2026-03-15T12:00:00Z'));
    expect(bills.create).not.toHaveBeenCalled();

    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    expect(bills.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: '2026-02', snapshot: expect.objectContaining({ proratedDays: 75 }) }),
    );

    await service.generateMonthlyBills(new Date('2026-05-15T12:00:00Z'));
    expect(bills.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: '2026-05', amount: 90000 }),
    );
  });

  it('末期不足整周期时按实际在租天数折算', async () => {
    const earlyEnd = {
      ...contract('ANNUAL'),
      endDate: new Date('2026-06-30T00:00:00Z'),
    };
    prisma.contract.findMany.mockResolvedValue([earlyEnd]);

    await service.generateMonthlyBills(new Date('2026-01-15T12:00:00Z'));

    const input = bills.create.mock.calls[0][0];
    expect(input.amount).toBeGreaterThan(0);
    expect(input.amount).toBeLessThan(90000);
    expect(input.snapshot).toMatchObject({ proratedDays: 181, cycle: 'ANNUAL' });
  });

  it('已存在账单时重跑跳过且不创建', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('MONTHLY')]);
    prisma.bill.findFirst.mockResolvedValue({ id: 'existing' });
    const result = await service.generateMonthlyBills(new Date('2026-01-15T12:00:00Z'));
    expect(result.skipped).toBe(1);
    expect(bills.create).not.toHaveBeenCalled();
  });

  it('非周期起始月不出账', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('ANNUAL')]);
    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    expect(bills.create).not.toHaveBeenCalled();
  });
});
