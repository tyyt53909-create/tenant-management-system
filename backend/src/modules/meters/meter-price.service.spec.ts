import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MeterPriceService } from './meter-price.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';

const clock = new BusinessClock({ get: () => undefined } as never);

const meter = { id: 'm-1', meterType: 'ELECTRICITY' as const, unitPrice: 100 };

function serviceWith(rows: Array<Record<string, unknown>>) {
  const prisma: any = {
    meterPriceHistory: {
      findMany: vi.fn().mockResolvedValue(rows),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    meter: { findUnique: vi.fn() },
  };
  return { prisma, service: new MeterPriceService(prisma, clock) };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    meterId: null as string | null,
    meterType: 'ELECTRICITY' as const,
    unitPrice: 100,
    effectiveDate: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('MeterPriceService（T274 计价）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('表级价优先于类型默认价，并只取生效日不晚于业务日的最新一条', async () => {
    const { service } = serviceWith([
      row({ meterId: 'm-1', unitPrice: 120, effectiveDate: new Date('2026-03-01T00:00:00Z') }),
      row({ meterId: 'm-1', unitPrice: 110, effectiveDate: new Date('2026-02-01T00:00:00Z') }),
      row({ meterId: null, unitPrice: 90, effectiveDate: new Date('2026-01-01T00:00:00Z') }),
    ]);

    expect(await service.resolveUnitPrice(meter, new Date('2026-01-15T00:00:00Z'))).toBe(90);
    expect(await service.resolveUnitPrice(meter, new Date('2026-02-15T00:00:00Z'))).toBe(110);
    expect(await service.resolveUnitPrice(meter, new Date('2026-04-15T00:00:00Z'))).toBe(120);
  });

  it('没有任何历史时回落到 Meter.unitPrice，非法日期也不抛错', async () => {
    const { service } = serviceWith([]);
    expect(await service.resolveUnitPrice(meter, new Date('2026-05-01T00:00:00Z'))).toBe(100);

    const book = await service.loadPriceBook([meter]);
    expect(book.priceFor(meter, new Date('invalid'))).toBe(100);
  });

  it('业务日按 Asia/Shanghai 归一：UTC 10-31 17:00 属于 11-01，取 11-01 新价', async () => {
    const { service } = serviceWith([
      row({ meterId: 'm-1', unitPrice: 100, effectiveDate: new Date('2026-10-01T00:00:00Z') }),
      row({ meterId: 'm-1', unitPrice: 130, effectiveDate: new Date('2026-11-01T00:00:00Z') }),
    ]);

    expect(
      await service.resolveUnitPrice(meter, new Date('2026-10-31T17:00:00Z')),
    ).toBe(130);
    expect(
      await service.resolveUnitPrice(meter, new Date('2026-10-31T15:00:00Z')),
    ).toBe(100);
  });

  it('批量价格簿只查一次，并按每笔读数时间分别取价', async () => {
    const { prisma, service } = serviceWith([
      row({ meterId: 'm-1', unitPrice: 110, effectiveDate: new Date('2026-02-01T00:00:00Z') }),
    ]);
    const other = { id: 'm-2', meterType: 'WATER' as const, unitPrice: 50 };
    const book = await service.loadPriceBook([meter, other]);

    expect(prisma.meterPriceHistory.findMany).toHaveBeenCalledTimes(1);
    expect(book.priceFor(meter, new Date('2026-01-10T00:00:00Z'))).toBe(100);
    expect(book.priceFor(meter, new Date('2026-02-10T00:00:00Z'))).toBe(110);
    expect(book.priceFor(other, new Date('2026-02-10T00:00:00Z'))).toBe(50);
  });

  it('recordPriceChange 同一生效日重复提交视为修正，不新增重复行', async () => {
    const { prisma, service } = serviceWith([]);
    prisma.meterPriceHistory.findFirst.mockResolvedValue(null);
    prisma.meterPriceHistory.create.mockImplementation(async ({ data }: any) => ({ id: 'new', ...data }));

    const created = await service.recordPriceChange(prisma, {
      meterId: 'm-1',
      meterType: 'ELECTRICITY',
      unitPrice: 120,
      effectiveDate: '2026-11-01',
      createdBy: 'admin-1',
    });
    expect(created).toMatchObject({ unitPrice: 120, meterId: 'm-1' });
    expect(prisma.meterPriceHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        effectiveDate: new Date('2026-11-01T00:00:00Z'),
      }),
    });

    const existing = row({ id: 'old', meterId: 'm-1', unitPrice: 120 });
    prisma.meterPriceHistory.findFirst.mockResolvedValue(existing);
    const same = await service.recordPriceChange(prisma, {
      meterId: 'm-1',
      meterType: 'ELECTRICITY',
      unitPrice: 120,
      effectiveDate: '2026-11-01',
      createdBy: 'admin-1',
    });
    expect(same).toBe(existing);
    expect(prisma.meterPriceHistory.create).toHaveBeenCalledTimes(1);

    prisma.meterPriceHistory.update.mockResolvedValue({ ...existing, unitPrice: 130 });
    const corrected = await service.recordPriceChange(prisma, {
      meterId: 'm-1',
      meterType: 'ELECTRICITY',
      unitPrice: 130,
      effectiveDate: '2026-11-01',
      createdBy: 'admin-2',
    });
    expect(corrected.unitPrice).toBe(130);
    expect(prisma.meterPriceHistory.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: { unitPrice: 130, createdBy: 'admin-2' },
    });
  });

  it('history 区分表级与类型默认价；表不存在返回 null', async () => {
    const { prisma, service } = serviceWith([
      row({ id: 'p1', meterId: 'm-1', unitPrice: 120 }),
      row({ id: 'p2', meterId: null, unitPrice: 100 }),
    ]);
    prisma.meter.findUnique.mockResolvedValue({
      id: 'm-1',
      meterType: 'ELECTRICITY',
      unitPrice: 120,
      priceEffectiveDate: new Date('2026-01-01'),
    });

    const history = await service.history('m-1');
    expect(history?.items.map((item) => [item.id, item.scope])).toEqual([
      ['p1', 'METER'],
      ['p2', 'TYPE'],
    ]);

    prisma.meter.findUnique.mockResolvedValue(null);
    expect(await service.history('missing')).toBeNull();
  });
});
