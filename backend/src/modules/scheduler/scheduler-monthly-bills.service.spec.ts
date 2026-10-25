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

  it('月付补齐已到期月份，金额等于月租金', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('MONTHLY')]);
    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    expect(bills.create).toHaveBeenCalledTimes(2);
    expect(bills.create.mock.calls.map((call: [{ period: string; amount: number }]) => call[0])).toEqual([
      expect.objectContaining({ period: '2026-01', amount: 90000 }),
      expect.objectContaining({ period: '2026-02', amount: 90000 }),
    ]);
  });

  it('季付漏期补账，完整季度是 3 倍月租金', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('QUARTERLY')]);
    await service.generateMonthlyBills(new Date('2026-05-15T12:00:00Z'));
    expect(bills.create.mock.calls.map((call: [{ period: string; amount: number }]) => [call[0].period, call[0].amount])).toEqual([
      ['2026-01', 270000],
      ['2026-04', 270000],
    ]);
  });

  it.each([
    ['SEMI_ANNUAL', 540000],
    ['ANNUAL', 1080000],
  ])('%s 周期起始月按月租金累加', async (cycle, amount) => {
    prisma.contract.findMany.mockResolvedValue([contract(cycle)]);
    await service.generateMonthlyBills(new Date('2026-01-15T12:00:00Z'));
    expect(bills.create).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-01', amount }));
  });

  it('首期月中开始按实际周期日数折算', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('MONTHLY', '2026-02-15')]);
    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    const input = bills.create.mock.calls[0][0];
    expect(input.amount).toBe(45000);
    expect(input.snapshot).toMatchObject({ cycle: 'MONTHLY', periodStart: '2026-02-15', periodEnd: '2026-02-28' });
  });

  it('季付以合同起始月为锚点：2 月起的合同在 2/5/8/11 月出账', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('QUARTERLY', '2026-02-15')]);

    await service.generateMonthlyBills(new Date('2026-03-15T12:00:00Z'));
    expect(bills.create).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-02', amount: 225000 }));

    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    expect(bills.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: '2026-02', amount: 225000 }),
    );

    await service.generateMonthlyBills(new Date('2026-05-15T12:00:00Z'));
    expect(bills.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: '2026-05', amount: 270000 }),
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
    expect(input.amount).toBe(540000);
    expect(input.snapshot).toMatchObject({ cycle: 'ANNUAL', periodEnd: '2026-06-30' });
  });

  it('已存在账单时重跑跳过且不创建', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('MONTHLY')]);
    prisma.bill.findFirst.mockResolvedValue({ id: 'existing' });
    const result = await service.generateMonthlyBills(new Date('2026-01-15T12:00:00Z'));
    expect(result.skipped).toBe(1);
    expect(bills.create).not.toHaveBeenCalled();
  });

  it('非锚点月仍补出已到期首期，不预开未来账期', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('ANNUAL')]);
    await service.generateMonthlyBills(new Date('2026-02-15T12:00:00Z'));
    expect(bills.create).toHaveBeenCalledTimes(1);
    expect(bills.create).toHaveBeenCalledWith(expect.objectContaining({ period: '2026-01', amount: 1080000 }));
  });

  it('上海业务日与 UTC 时间戳算出同一账期和金额', async () => {
    prisma.contract.findMany.mockResolvedValue([contract('MONTHLY', '2026-02-15')]);
    await service.generateMonthlyBills(new Date('2026-02-14T16:30:00Z'));
    const fromUtcEvening = bills.create.mock.calls.at(-1)[0];
    bills.create.mockClear();
    await service.generateMonthlyBills(new Date('2026-02-15T02:30:00Z'));
    const fromShanghaiMorning = bills.create.mock.calls.at(-1)[0];
    expect(fromUtcEvening).toMatchObject({ period: '2026-02', amount: 45000 });
    expect(fromShanghaiMorning).toMatchObject({ period: fromUtcEvening.period, amount: fromUtcEvening.amount });
  });
});
