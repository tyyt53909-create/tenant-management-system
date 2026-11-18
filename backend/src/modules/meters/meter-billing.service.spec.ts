import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { MeterBillingService } from './meter-billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { testClock, testPriceService } from './meter-test.providers.js';

describe('MeterBillingService', () => {
  let service: MeterBillingService;
  let prisma: any;
  const meter = {
    id: 'meter-1', meterType: 'ELECTRICITY', meterNumber: 'E-1', unitPrice: 10, roomId: 'room-1',
  };
  const reading = { id: 'reading-1', readingTime: new Date('2026-01-15T12:00:00Z') };

  beforeEach(async () => {
    const mock: any = {
      meter: { findUnique: vi.fn(), findMany: vi.fn() },
      meterReading: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      contract: { findFirst: vi.fn() },
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
    expect(await service.applyReadingDeduction(tx, { ...meter, roomId: null }, reading, 1, 'op')).toMatchObject({ applied: false });
    expect(await service.applyReadingDeduction(tx, meter, reading, 0, 'op')).toMatchObject({ applied: false });
    tx.contract.findFirst.mockResolvedValueOnce(null);
    expect(await service.applyReadingDeduction(tx, meter, reading, 1, 'op')).toMatchObject({ applied: false });
    tx.contract.findFirst.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });
    tx.prepayAccount.findUnique.mockResolvedValueOnce(null);
    expect(await service.applyReadingDeduction(tx, meter, reading, 1, 'op')).toMatchObject({ applied: false, reasonCode: 'MISSING_PREPAY_ACCOUNT' });
    expect(tx.bill.create).not.toHaveBeenCalled();
    expect(tx.prepayTransaction.create).not.toHaveBeenCalled();
  });

  it('deducts available balance and bills shortfall, including failed conditional update and unknown label', async () => {
    const tx: any = prisma;
    tx.contract.findFirst.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });
    tx.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 4 });
    tx.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    tx.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 0 });
    tx.prepayTransaction.create.mockResolvedValue({ id: 'txn-1' });
    tx.bill.create.mockResolvedValue({ id: 'bill-1' });
    const result = await service.applyReadingDeduction(tx, { ...meter, meterType: 'UNKNOWN' }, reading, 1, 'op');
    expect(result).toMatchObject({ applied: true, amount: 10, deducted: 4, shortfall: 6 });
    expect(tx.bill.create).toHaveBeenCalled();

    tx.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 20 });
    tx.prepayAccount.updateMany.mockResolvedValue({ count: 0 });
    const noDeduction = await service.applyReadingDeduction(tx, meter, reading, 1, 'op');
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
    prisma.meterReading.findFirst.mockResolvedValueOnce({ currentReading: 5 });
    prisma.prepayAccount.findUnique.mockResolvedValue(null);
    const preview = await service.getUnsettledUsage(meter.id);
    expect(preview).toMatchObject({ unsettledUsage: 20, estimatedAmount: 200, prepayBalance: null });

    prisma.meter.findUnique.mockResolvedValue({ ...meter, room: { contracts: [{ tenantId: 't', tenant: { name: 'A' } }] } });
    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 10 });
    prisma.meterReading.findFirst.mockResolvedValueOnce({ id: 'base', currentReading: 3, readingTime: reading.readingTime });
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
    prisma.meterReading.findFirst.mockResolvedValueOnce({ currentReading: 5 });
    expect(await service.settleMeter('m', {}, 'op')).toMatchObject({ settled: true, usage: 0 });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 8, notes: null });
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.meterReading.findFirst.mockResolvedValueOnce({ currentReading: 2 });
    prisma.contract.findFirst.mockResolvedValue(null);
    expect(await service.settleMeter('m', {}, 'op')).toMatchObject({ settled: false, usage: 6 });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 8, notes: 'n' });
    prisma.meterReading.findFirst.mockResolvedValueOnce({ id: 'base', currentReading: 2, settledAt: new Date() });
    prisma.contract.findFirst.mockResolvedValue({ id: 'c', tenantId: 't' });
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 100 });
    prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 40 });
    prisma.prepayTransaction.create.mockResolvedValue({ id: 'p' });
    expect(await service.settleMeter('m', { notes: 'ok' }, 'op')).toMatchObject({ settled: true, usage: 6 });

    prisma.meterReading.findFirst.mockReset();
    prisma.meterReading.findFirst.mockResolvedValueOnce({ ...reading, id: 'latest', currentReading: 8, notes: '' });
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    prisma.contract.findFirst.mockResolvedValue(null);
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
    prisma.meter.findMany.mockClear();
    expect(await service.settleBatch({ meterIds: [] }, 'op')).toMatchObject({ total: 0 });
    expect(await service.settleBatch({ buildingId: 'building-1', meterIds: [] }, 'op')).toMatchObject({ total: 0 });
    await expect(service.settleBatch({}, 'op')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.meter.findMany).not.toHaveBeenCalled();
    vi.spyOn(service, 'settleMeter').mockResolvedValue({ meterId: 'd', ...settled });
    expect(await service.settleBatch({ meterIds: ['d'], settleUntil: '2026-01-31', notes: 'batch' }, 'op')).toMatchObject({ successCount: 1 });
  });

  it('仅将本服务的未找到表计与缺读数归为预期错误，其余错误安全记录后继续', async () => {
    prisma.meter.findUnique.mockResolvedValueOnce(null).mockResolvedValue(meter);
    prisma.meterReading.findFirst.mockResolvedValueOnce(null);
    const sensitive = 'sensitive-failure-fixture';
    const settle = vi.fn<MeterBillingService['settleMeter']>()
      .mockImplementationOnce(service.settleMeter.bind(service))
      .mockImplementationOnce(service.settleMeter.bind(service))
      .mockRejectedValueOnce(new NotFoundException(sensitive))
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(sensitive, {
        code: 'P2034', clientVersion: 'test', meta: { field: sensitive },
      }))
      .mockResolvedValueOnce({ meterId: 'later', settled: true, status: 'SETTLED', reasonCode: 'SETTLED', usage: 1, amount: 10 });
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const result = await service.settleBatch({ meterIds: ['missing', 'empty', 'other', 'db', 'later'] }, 'op', settle);
      expect(result.results.map(({ reasonCode }) => reasonCode)).toEqual([
        'METER_NOT_FOUND', 'NO_READINGS', 'SETTLEMENT_FAILED', 'SETTLEMENT_FAILED', 'SETTLED',
      ]);
      expect(JSON.stringify(result)).not.toContain(sensitive);
      expect(logger.mock.calls).toEqual([
        [{ event: 'meter.batch_settlement.failed', meterId: 'other', reasonCode: 'SETTLEMENT_FAILED', errorKind: 'HttpException', httpStatus: 404 }],
        [{ event: 'meter.batch_settlement.failed', meterId: 'db', reasonCode: 'SETTLEMENT_FAILED', errorKind: 'PrismaKnownRequestError', prismaCode: 'P2034' }],
      ]);
    } finally {
      logger.mockRestore();
    }
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
      return { currentReading: 100 };
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
      return { currentReading: 100 };
    });
    prisma.contract.findFirst.mockResolvedValue({ id: 'c', tenantId: 't' });
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
      return { currentReading: 100 };
    });
    prisma.contract.findFirst.mockResolvedValue({ id: 'c', tenantId: 't' });
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
      return { currentReading: 100 };
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
      return { currentReading: 100 };
    });
    prisma.contract.findFirst.mockResolvedValue({ id: 'c', tenantId: 't' });
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
    prisma.contract.findFirst.mockResolvedValue({ id: 'c', tenantId: 't' });
    prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 100 });
    prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 0 });
    prisma.prepayTransaction.create.mockResolvedValue({ id: 'p' });
    prisma.bill.create.mockResolvedValue({ id: 'b' });

    // 当前价 10 分，但按历史生效价 30 分结算 4 单位 = 120 分
    const result = await service.applyReadingDeduction(prisma, meter, reading, 4, 'op', 30);

    expect(result).toMatchObject({ applied: true, amount: 120, deducted: 100, shortfall: 20 });
    expect(prisma.bill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 20,
        snapshot: expect.objectContaining({ unitPrice: 30, totalAmount: 120, shortfall: 20 }),
      }),
    });
  });
});
