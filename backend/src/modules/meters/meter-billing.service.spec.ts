import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MeterBillingService } from './meter-billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { meterTestContract, testClock, testPriceService } from './meter-test.providers.js';

describe('MeterBillingService', () => {
  let service: MeterBillingService;
  let prisma: any;
  const meter = {
    id: 'meter-1', meterType: 'ELECTRICITY', meterNumber: 'E-1', unitPrice: 10, roomId: 'room-1',
  };
  const reading = { id: 'reading-1', readingTime: new Date('2026-01-15T12:00:00Z') };
  const baseline = { id: 'base', readingTime: new Date('2026-01-14T12:00:00Z') };

  beforeEach(async () => {
    const mock: any = {
      meter: { findUnique: vi.fn(), findMany: vi.fn() },
      meterReading: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      contract: { findMany: vi.fn().mockResolvedValue([]) },
      prepayAccount: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
      prepayTransaction: { create: vi.fn() },
      bill: { create: vi.fn() },
      meterPriceHistory: { findMany: vi.fn() },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    mock.$transaction.mockImplementation(async (callback: any) => callback(mock));
    mock.meterPriceHistory.findMany.mockResolvedValue([]);
    mock.meterReading.findMany.mockResolvedValue([]);
    mock.$queryRaw.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeterBillingService,
        { provide: PrismaService, useValue: mock },
        // QLT-02 / T288：时钟与计价必填
        { provide: BusinessClock, useValue: testClock() },
        { provide: MeterPriceService, useValue: testPriceService(mock) },
      ],
    }).compile();
    service = module.get(MeterBillingService);
    prisma = mock;
  });

  it('skips public-area and zero-value readings; handles missing contract/account', async () => {
    const tx: any = prisma;
    expect(await service.applyReadingDeduction(tx, { ...meter, roomId: null }, reading, 1, 'op', baseline)).toMatchObject({ applied: false });
    expect(await service.applyReadingDeduction(tx, meter, reading, 0, 'op', baseline)).toMatchObject({ applied: false });
    tx.contract.findMany.mockResolvedValueOnce([]);
    expect(await service.applyReadingDeduction(tx, meter, reading, 1, 'op', baseline)).toMatchObject({ applied: false });
    tx.contract.findMany.mockResolvedValue([meterTestContract('contract-1', 'tenant-1')]);
    tx.prepayAccount.findUnique.mockResolvedValueOnce(null);
    expect(await service.applyReadingDeduction(tx, meter, reading, 1, 'op', baseline)).toMatchObject({ applied: false, reasonCode: 'MISSING_PREPAY_ACCOUNT' });
    expect(tx.bill.create).not.toHaveBeenCalled();
    expect(tx.prepayTransaction.create).not.toHaveBeenCalled();
  });

  it('连续续租可沿用同一租客的入住依据，同时阻断跨合同累计扣费', async () => {
    const prior = {
      ...meterTestContract('prior'),
      status: 'RENEWED',
      endDate: new Date('2026-01-14'),
    };
    const successor = {
      ...meterTestContract('successor'),
      startDate: new Date('2026-01-15'),
      renewedFromId: prior.id,
    };
    prisma.contract.findMany.mockResolvedValue([prior, successor]);
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 0 });
    prisma.bill.create.mockResolvedValue({ id: 'bill-1' });

    const crossContract = await service.applyReadingDeduction(prisma, meter, reading, 1, 'op', baseline);
    expect(crossContract).toMatchObject({ applied: false, reasonCode: 'OCCUPANCY_UNCERTAIN' });
    expect(prisma.bill.create).not.toHaveBeenCalled();
    const afterRenewal = await service.applyReadingDeduction(prisma, meter, reading, 1, 'op', {
      ...baseline, readingTime: new Date('2026-01-15T02:00:00Z'),
    });
    expect(afterRenewal).toMatchObject({ applied: true, contractId: 'successor' });
  });

  it.each([true, false])('以已确认入住为界处理空置用量（入住确认=%s）', async (confirmed) => {
    const inspection = (type: 'CHECK_IN' | 'CHECK_OUT', inspectedAt: Date, tenantId: string) => ({
      type, inspectedAt, tenantId, roomId: meter.roomId, tenantConfirmedAt: inspectedAt,
    });
    prisma.contract.findMany.mockResolvedValue([
      {
        ...meterTestContract('prior', 'old-tenant'),
        status: 'TERMINATED',
        endDate: new Date('2026-01-14'),
        inspections: [inspection('CHECK_OUT', baseline.readingTime, 'old-tenant')],
      },
      {
        ...meterTestContract('next', 'new-tenant'),
        startDate: new Date('2026-01-15'),
        inspections: confirmed ? [inspection('CHECK_IN', reading.readingTime, 'new-tenant')] : [],
      },
    ]);
    prisma.meter.findUnique.mockResolvedValue(meter);
    const latest = { ...reading, currentReading: 110, notes: null };
    const cursor = { ...baseline, currentReading: 100, settledAt: baseline.readingTime };
    prisma.meterReading.findFirst.mockResolvedValueOnce(latest).mockResolvedValueOnce(cursor)
      .mockResolvedValueOnce(latest).mockResolvedValueOnce(cursor);

    const reasonCode = confirmed ? 'VACANT_INTERVAL' : 'OCCUPANCY_UNCERTAIN';
    expect(await service.getUnsettledUsage(meter.id)).toMatchObject({
      unsettledUsage: 10, tenantName: null, estimatedAmount: confirmed ? 0 : 100,
      attribution: { reasonCode },
    });
    expect(await service.settleMeter(meter.id, {}, 'op')).toMatchObject({
      status: confirmed ? 'NO_CHANGE' : 'BLOCKED', reasonCode, settled: confirmed,
      usage: 10, amount: confirmed ? 0 : 100,
    });

    expect(prisma.prepayAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.bill.create).not.toHaveBeenCalled();
    if (confirmed) {
      expect(prisma.meterReading.update).toHaveBeenCalledWith({
        where: { id: reading.id },
        data: expect.objectContaining({ settledUsage: 10, settledAmount: 0, notes: '[SETTLED] [VACANT_USAGE]' }),
      });
    } else {
      expect(prisma.meterReading.update).not.toHaveBeenCalled();
    }
  });

  it('有效租住区间的零单价用量不进入资金账', async () => {
    prisma.contract.findMany.mockResolvedValue([meterTestContract()]);
    const result = await service.applyReadingDeduction(prisma, meter, reading, 1, 'op', baseline, 0);
    expect(result).toMatchObject({ applied: false, reasonCode: 'ZERO_CHARGE' });
    expect(prisma.prepayAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.bill.create).not.toHaveBeenCalled();
  });

  it('拒绝在单笔和批量周期结算备注中写入空置标记', async () => {
    const notes = '[VACANT_USAGE]';
    await expect(service.settleMeter(meter.id, { notes }, 'op')).rejects.toThrow('系统保留标记');
    await expect(service.settleBatch({ meterIds: [meter.id], notes }, 'op')).rejects.toThrow('系统保留标记');
    expect(prisma.meterReading.update).not.toHaveBeenCalled();
  });

  it('deducts available balance and bills shortfall, including failed conditional update and unknown label', async () => {
    const tx: any = prisma;
    tx.contract.findMany.mockResolvedValue([meterTestContract('contract-1', 'tenant-1')]);
    tx.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 4 });
    tx.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    tx.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 0 });
    tx.prepayTransaction.create.mockResolvedValue({ id: 'txn-1' });
    tx.bill.create.mockResolvedValue({ id: 'bill-1' });
    const result = await service.applyReadingDeduction(tx, { ...meter, meterType: 'UNKNOWN' }, reading, 1, 'op', baseline);
    expect(result).toMatchObject({ applied: true, amount: 10, deducted: 4, shortfall: 6 });
    expect(tx.bill.create).toHaveBeenCalled();

    tx.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 20 });
    tx.prepayAccount.updateMany.mockResolvedValue({ count: 0 });
    const noDeduction = await service.applyReadingDeduction(tx, meter, reading, 1, 'op', baseline);
    expect(noDeduction).toMatchObject({ applied: true, deducted: 0, shortfall: 10 });
  });

  it('previews missing/no readings, settled and unsettled readings with/without baseline and account', async () => {
    prisma.meter.findUnique.mockResolvedValueOnce(null);
    await expect(service.getUnsettledUsage('missing')).rejects.toBeInstanceOf(NotFoundException);
    prisma.meter.findUnique.mockResolvedValue(meter);
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    expect(await service.getUnsettledUsage(meter.id)).toMatchObject({ hasReadings: false, unsettledUsage: 0 });

    prisma.meter.findUnique.mockResolvedValue({ ...meter, room: { roomNumber: '101', contracts: [] } });
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, currentReading: 20 });
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, currentReading: 20, settledAt: new Date() });
    expect(await service.getUnsettledUsage(meter.id)).toMatchObject({ hasReadings: true, unsettledUsage: 0 });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 25 });
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...baseline, currentReading: 5 });
    prisma.prepayAccount.findUnique.mockResolvedValue(null);
    const preview = await service.getUnsettledUsage(meter.id);
    expect(preview).toMatchObject({ unsettledUsage: 20, estimatedAmount: 200, prepayBalance: null });

    prisma.meter.findUnique.mockResolvedValue({ ...meter, room: { contracts: [{ tenantId: 't', tenant: { name: 'A' } }] } });
    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 10 });
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...baseline, currentReading: 3, settledAt: baseline.readingTime });
    prisma.contract.findMany.mockResolvedValue([meterTestContract('c', 't', 'A')]);
    prisma.prepayAccount.findUnique.mockResolvedValue({ balanceCache: 12 });
    expect(await service.getUnsettledUsage(meter.id)).toMatchObject({ prepayBalance: 12, tenantName: 'A', roomNumber: '公共区域' });
  });

  it('settles error, already-settled, zero-use, unapplied and applied cases', async () => {
    prisma.meter.findUnique.mockResolvedValue(null);
    await expect(service.settleMeter('m', {}, 'op')).rejects.toBeInstanceOf(NotFoundException);
    prisma.meter.findUnique.mockResolvedValue(meter);
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    await expect(service.settleMeter('m', {}, 'op')).rejects.toBeInstanceOf(BadRequestException);

    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 5 });
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 5, settledAt: new Date() });
    expect(await service.settleMeter('m', {}, 'op')).toMatchObject({ settled: false });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 5, notes: 'note' });
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...baseline, currentReading: 5 });
    expect(await service.settleMeter('m', {}, 'op')).toMatchObject({ settled: true, usage: 0 });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 8, notes: null });
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...baseline, currentReading: 2 });
    prisma.contract.findMany.mockResolvedValue([]);
    expect(await service.settleMeter('m', {}, 'op')).toMatchObject({ settled: false, usage: 6 });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 8, notes: 'n' });
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...baseline, currentReading: 2, settledAt: new Date() });
    prisma.contract.findMany.mockResolvedValue([meterTestContract('c', 't')]);
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 100 });
    prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 40 });
    prisma.prepayTransaction.create.mockResolvedValue({ id: 'p' });
    expect(await service.settleMeter('m', { notes: 'ok' }, 'op')).toMatchObject({ settled: true, usage: 6 });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 8, notes: '' });
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.contract.findMany.mockResolvedValue([]);
    await service.settleMeter('m', { settleUntil: '2026-01-20' }, 'op');
  });

  it('settles batches from explicit IDs or queried building, using default/custom functions and captures errors', async () => {
    const settled = { settled: true as const, status: 'SETTLED' as const, reasonCode: 'SETTLED' as const, usage: 5, amount: 50 };
    const custom = vi.fn<MeterBillingService['settleMeter']>()
      .mockResolvedValueOnce({ meterId: 'a', ...settled }).mockRejectedValueOnce(new Error('database details'));
    const explicit = await service.settleBatch({ meterIds: ['a', 'b'] }, 'op', custom);
    expect(explicit).toMatchObject({ total: 2, settledCount: 1, noChangeCount: 0, blockedCount: 0, failedCount: 1 });
    expect(explicit.results[1]).toMatchObject({ status: 'FAILED', reasonCode: 'SETTLEMENT_FAILED', error: '结算执行失败' });
    prisma.meter.findMany.mockResolvedValue([{ id: 'c' }]);
    const result = await service.settleBatch({ buildingId: 'building-1' }, 'op', async (id) => ({ meterId: id, ...settled }));
    expect(result).toMatchObject({ total: 1, successCount: 1 });
    expect(prisma.meter.findMany).toHaveBeenCalledWith({ where: { isActive: true, buildingId: 'building-1' }, select: { id: true } });
    prisma.meter.findMany.mockResolvedValue([]);
    expect(await service.settleBatch({ meterIds: [] }, 'op')).toMatchObject({ total: 0 });
    vi.spyOn(service, 'settleMeter').mockResolvedValue({ meterId: 'd', ...settled });
    expect(await service.settleBatch({ meterIds: ['d'], settleUntil: '2026-01-31', notes: 'batch' }, 'op')).toMatchObject({ successCount: 1 });
  });

  it('t196: 预览支持显式截止时间；无基线无账户时基线与余额兜底', async () => {
    prisma.meter.findUnique.mockResolvedValue(meter);
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    expect(await service.getUnsettledUsage(meter.id, '2026-01-10')).toMatchObject({ hasReadings: false });

    prisma.meter.findUnique.mockResolvedValue({
      ...meter,
      roomId: 'room-1',
      room: { contracts: [{ tenantId: 't-9', tenant: { name: 'B' } }] },
    });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.OR) return null;
      if (args?.where?.readingTime) return { ...reading, id: 'latest', currentReading: 100 };
      return null;
    });
    prisma.prepayAccount.findUnique.mockResolvedValue(null);
    const preview = await service.getUnsettledUsage(meter.id);
    expect(preview).toMatchObject({ unsettledUsage: 100, estimatedAmount: 1000, prepayBalance: null });
  });

  it('t196: 周期结算用量为 0 且原备注为空时独立盖 SETTLED', async () => {
    prisma.meter.findUnique.mockResolvedValue(meter);
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.OR) return null;
      if (args?.where?.readingTime)
        return { ...reading, id: 'latest', currentReading: 100, notes: null };
      return { ...baseline, currentReading: 100 };
    });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.settleMeter('m', {}, 'op');
    expect(result).toMatchObject({ settled: true, usage: 0 });
    expect(prisma.meterReading.update).toHaveBeenCalledWith({
      where: { id: 'latest' },
      data: expect.objectContaining({ notes: '[SETTLED]' }),
    });
  });

  it('t196: 周期结算成功且原备注为空时 SETTLED 独立成备注', async () => {
    prisma.meter.findUnique.mockResolvedValue(meter);
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.OR) return null;
      if (args?.where?.readingTime)
        return { ...reading, id: 'latest', currentReading: 110, notes: null };
      return { ...baseline, currentReading: 100 };
    });
    prisma.contract.findMany.mockResolvedValue([meterTestContract('c', 't')]);
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 5000 });
    prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 4000 });
    prisma.prepayTransaction.create.mockResolvedValue({ id: 'p' });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.settleMeter('m', {}, 'op');
    expect(result).toMatchObject({ settled: true, usage: 10 });
    expect(prisma.meterReading.update).toHaveBeenCalledWith({
      where: { id: 'latest' },
      data: expect.objectContaining({ notes: '[SETTLED]' }),
    });
  });

  it('t196: 未知表类型走默认费用标签', async () => {
    prisma.meter.findUnique.mockResolvedValue({ ...meter, meterType: 'SOLAR_ARRAY' });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.OR) return null;
      if (args?.where?.readingTime)
        return { ...reading, id: 'latest', currentReading: 110, notes: 'n' };
      return { ...baseline, currentReading: 100 };
    });
    prisma.contract.findMany.mockResolvedValue([meterTestContract('c', 't')]);
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 5000 });
    prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 4000 });
    prisma.prepayTransaction.create.mockImplementation(async ({ data }: any) => ({ id: 'p', ...data }));
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.settleMeter('m', {}, 'op');
    expect(result).toMatchObject({ settled: true });
    expect(prisma.prepayTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: expect.stringContaining('水电费') }) }),
    );
  });

  it('公共区域表无应收入账，也不变更结算游标', async () => {
    prisma.meter.findUnique.mockResolvedValue({ ...meter, roomId: null });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.OR) return null;
      if (args?.where?.readingTime)
        return { ...reading, id: 'latest', currentReading: 110, notes: 'n' };
      return { ...baseline, currentReading: 100 };
    });
    const result = await service.settleMeter('m', {}, 'op');
    expect(result).toMatchObject({ settled: false, status: 'NO_CHANGE', reasonCode: 'PUBLIC_AREA', usage: 10 });
    expect(prisma.meterReading.update).not.toHaveBeenCalled();
  });

  it('t196: 原备注为空但结算单有备注时 SETTLED 后拼接备注', async () => {
    prisma.meter.findUnique.mockResolvedValue(meter);
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.OR) return null;
      if (args?.where?.readingTime)
        return { ...reading, id: 'latest', currentReading: 110, notes: null };
      return { ...baseline, currentReading: 100 };
    });
    prisma.contract.findMany.mockResolvedValue([meterTestContract('c', 't')]);
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 5000 });
    prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 4000 });
    prisma.prepayTransaction.create.mockResolvedValue({ id: 'p' });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.settleMeter('m', { notes: '月结备注' }, 'op');
    expect(result).toMatchObject({ settled: true, usage: 10 });
    expect(prisma.meterReading.update).toHaveBeenCalledWith({
      where: { id: 'latest' },
      data: expect.objectContaining({ notes: '[SETTLED] 备注:月结备注' }),
    });
  });

  it('T274：显式传入生效单价时，扣费、差额账单与快照都用该价而非当前价', async () => {
    prisma.contract.findMany.mockResolvedValue([meterTestContract('c', 't')]);
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 100 });
    prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 0 });
    prisma.prepayTransaction.create.mockResolvedValue({ id: 'p' });
    prisma.bill.create.mockResolvedValue({ id: 'b' });

    // 当前价 10 分，但按历史生效价 30 分结算 4 单位 = 120 分
    const result = await service.applyReadingDeduction(prisma, meter, reading, 4, 'op', baseline, 30);

    expect(result).toMatchObject({ applied: true, amount: 120, deducted: 100, shortfall: 20 });
    expect(prisma.bill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 20,
        snapshot: expect.objectContaining({ unitPrice: 30, totalAmount: 120, shortfall: 20 }),
      }),
    });
  });
});
