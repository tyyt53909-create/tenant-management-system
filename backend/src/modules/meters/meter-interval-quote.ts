import type { Prisma } from '@prisma/client';
import type { MeterPriceInput, MeterPriceService } from './meter-price.service.js';
import { realMeterReadings } from './meter-reading-scope.js';

interface IntervalReading {
  id: string;
  readingTime: Date;
  currentReading: number | Prisma.Decimal;
  handoffRequired?: boolean;
  handoffPreviousFinal?: number | Prisma.Decimal | null;
  handoffConfirmedAt?: Date | null;
}

export interface MeterChargeSegment {
  startReadingId: string;
  endReadingId: string;
  startAt: string;
  endAt: string;
  startReading: number;
  endReading: number;
  usage: number;
  unitPrice: number;
  nextOpeningReading?: number;
}

const UNCONFIRMED_HANDOFF = {
  reasonCode: 'UNCONFIRMED_HANDOFF',
  reason: '读数回退或交接底数存在冲突，已暂停结算',
  retryCondition: '核对回退或换表当时的旧表末数和新表底数，并确认交接读数',
} as const;

const MISSING_RATE_BOUNDARY = {
  reasonCode: 'MISSING_RATE_BOUNDARY',
  reason: '跨费率区间缺少生效界点读数或历史单价，已暂停结算',
  retryCondition: '核对历史费率并补录业务时区调价生效时刻的真实读数',
} as const;

export type MeterIntervalBlock = typeof UNCONFIRMED_HANDOFF | typeof MISSING_RATE_BOUNDARY;
export interface MeterIntervalQuote {
  usage: number;
  amount: number;
  unitPrice: number;
  segments: MeterChargeSegment[];
}

type QuoteDb = Pick<Prisma.TransactionClient, 'meterReading' | 'meterPriceHistory'>;

export async function quoteMeterInterval(
  db: QuoteDb,
  prices: MeterPriceService,
  meter: MeterPriceInput,
  baseline: IntervalReading | null,
  target: IntervalReading,
  fallbackUsage = 0,
): Promise<MeterIntervalQuote | MeterIntervalBlock> {
  const book = await prices.loadPriceBook([meter], db);
  const currentRate = book.priceFor(meter, target.readingTime);

  if (baseline?.handoffRequired && (!baseline.handoffConfirmedAt || baseline.handoffPreviousFinal == null)) {
    return UNCONFIRMED_HANDOFF;
  }
  // 无可信底数的正用量仍由归属校验阻断，不能直接把零当作起点。
  if (!baseline?.readingTime) {
    if (target.handoffRequired) return UNCONFIRMED_HANDOFF;
    return { usage: fallbackUsage, amount: Math.round(fallbackUsage * currentRate), unitPrice: currentRate, segments: [] };
  }
  if (baseline.id === target.id) return { usage: 0, amount: 0, unitPrice: currentRate, segments: [] };
  if (baseline.readingTime >= target.readingTime) return UNCONFIRMED_HANDOFF;
  if (book.hasUnpricedHistory(meter, baseline.readingTime)) return MISSING_RATE_BOUNDARY;

  const rows = await db.meterReading.findMany({
    where: {
      meterId: meter.id,
      ...realMeterReadings(db),
      readingTime: { gte: baseline.readingTime, lte: target.readingTime },
      id: { notIn: [baseline.id, target.id] },
    },
    select: { id: true, readingTime: true, currentReading: true, handoffRequired: true, handoffPreviousFinal: true, handoffConfirmedAt: true },
    orderBy: [{ readingTime: 'asc' }, { id: 'asc' }],
  });
  const changes = book.changesBetween(meter, baseline.readingTime, target.readingTime);
  if (changes.some(({ at, hasPriorRate }) => at === null || !hasPriorRate)) return MISSING_RATE_BOUNDARY;

  const segments: MeterChargeSegment[] = [];
  let unitPrice = book.priceFor(meter, baseline.readingTime);
  let changeIndex = 0;
  let previous = baseline;
  let totalUnits = 0;
  let totalHundredthsOfCent = 0n;

  for (const next of [...rows, target]) {
    const opening = Number(previous.currentReading);
    const handoff = next.handoffConfirmedAt != null && next.handoffPreviousFinal != null;
    if (!handoff && (next.handoffRequired || next.handoffPreviousFinal != null)) return UNCONFIRMED_HANDOFF;
    const closing = Number(handoff ? next.handoffPreviousFinal : next.currentReading);
    if (next.readingTime.getTime() === previous.readingTime.getTime()) {
      if (Number(next.currentReading) !== opening || handoff) {
        return UNCONFIRMED_HANDOFF;
      }
      continue;
    }

    const units = Math.round(closing * 100) - Math.round(opening * 100);
    if (units < 0) return UNCONFIRMED_HANDOFF;

    const nextAt = next.readingTime.getTime();
    const boundary = changes[changeIndex];
    if (boundary?.at != null && boundary.at < nextAt) return MISSING_RATE_BOUNDARY;

    totalUnits += units;
    totalHundredthsOfCent += BigInt(units) * BigInt(unitPrice);
    const last = segments.at(-1);
    const end = {
      endReadingId: next.id, endAt: next.readingTime.toISOString(), endReading: closing,
      ...(handoff && { nextOpeningReading: Number(next.currentReading) }),
    };
    if (last && last.unitPrice === unitPrice && last.nextOpeningReading === undefined) {
      Object.assign(last, end, { usage: (Math.round(last.usage * 100) + units) / 100 });
    } else {
      segments.push({
        startReadingId: previous.id, startAt: previous.readingTime.toISOString(),
        startReading: opening, usage: units / 100, unitPrice, ...end,
      });
    }
    if (boundary?.at === nextAt) {
      unitPrice = boundary.unitPrice;
      changeIndex += 1;
    }
    previous = next;
  }

  // 保留每段精度，合计后只舍入一次。计费结果按整数分写入。
  return {
    usage: totalUnits / 100,
    amount: Number((totalHundredthsOfCent + 50n) / 100n),
    unitPrice: segments.find((segment) => segment.usage > 0)?.unitPrice ?? currentRate,
    segments,
  };
}
