import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { quoteMeterInterval } from './meter-interval-quote.js';
import { MeterPriceService, type MeterPriceRow } from './meter-price.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const clock = new BusinessClock({ get: () => 'Asia/Shanghai' } as never);
const meter = { id: 'm-1', meterType: 'ELECTRICITY' as const, unitPrice: 100 };
const reading = (id: string, time: string, currentReading: number) =>
  ({ id, readingTime: new Date(time), currentReading });
const opening = reading('start', '2026-01-01T00:00:00Z', 100);
const boundary = reading('boundary', '2026-01-19T16:00:00Z', 100.01);
const target = reading('end', '2026-01-21T00:00:00Z', 100.02);

function setup(rows: Array<ReturnType<typeof reading>> = [], rates: MeterPriceRow[] = []) {
  const db = {
    meterReading: { findMany: vi.fn().mockResolvedValue(rows), fields: {} },
    meterPriceHistory: { findMany: vi.fn().mockResolvedValue(rates) },
  };
  const prices = new MeterPriceService(db as unknown as PrismaService, clock);
  return (start: Parameters<typeof quoteMeterInterval>[3], end: Parameters<typeof quoteMeterInterval>[4]) =>
    quoteMeterInterval(db as unknown as Prisma.TransactionClient, prices, meter, start, end);
}

function rate(day: string, unitPrice: number, meterId: string | null = meter.id): MeterPriceRow {
  return {
    meterId, unitPrice, meterType: meter.meterType, effectiveDate: new Date(day), createdAt: new Date(day),
  };
}

describe('quoteMeterInterval', () => {
  it('按实际生效价切段并忽略被表级价覆盖的默认价变更', async () => {
    const quote = setup([boundary], [
      rate('2026-01-01', 150), rate('2026-01-20', 250), rate('2026-01-10', 999, null),
    ]);
    expect(await quote(opening, target)).toMatchObject({
      usage: 0.02, amount: 4,
      segments: [
        { startReadingId: opening.id, endReadingId: boundary.id, usage: 0.01, unitPrice: 150 },
        { startReadingId: boundary.id, endReadingId: target.id, usage: 0.01, unitPrice: 250 },
      ],
    });
  });

  it('缺少历史起始价或恰好在生效时刻的真实读数时不推算', async () => {
    await expect(setup([boundary], [rate('2026-01-20', 250)])(opening, target))
      .resolves.toMatchObject({ reasonCode: 'MISSING_RATE_BOUNDARY' });
    await expect(setup([], [rate('2026-01-01', 150), rate('2026-01-20', 250)])(opening, target))
      .resolves.toMatchObject({ reasonCode: 'MISSING_RATE_BOUNDARY' });
  });

  it('同一时刻相同读数可合并，存在冲突或未经确认的回退时阻断', async () => {
    const copy = { ...opening, id: 'duplicate' };
    await expect(setup([copy])(opening, target)).resolves.toMatchObject({ usage: 0.02, amount: 2 });
    await expect(setup([{ ...copy, currentReading: 101 }])(opening, target))
      .resolves.toMatchObject({ reasonCode: 'UNCONFIRMED_HANDOFF' });
    await expect(setup()(opening, { ...target, currentReading: 1 }))
      .resolves.toMatchObject({ reasonCode: 'UNCONFIRMED_HANDOFF' });
    await expect(setup()({ ...opening, handoffRequired: true }, target))
      .resolves.toMatchObject({ reasonCode: 'UNCONFIRMED_HANDOFF' });
  });
});
