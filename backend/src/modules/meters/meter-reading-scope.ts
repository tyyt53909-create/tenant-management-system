import type { MeterReading, Prisma } from '@prisma/client';

const LEGACY_ANOMALY_PREFIX = '[ANOMALY]';

type ReadingClient = Pick<Prisma.TransactionClient, 'meterReading'>;

/** 可进入真实结算、读数底表和统计的记录。旧异常模拟器曾写入 DEVICE。 */
export function realMeterReadings(db: ReadingClient): Prisma.MeterReadingWhereInput {
  return {
    source: { not: 'SIMULATED' },
    AND: [
      { readingTime: { lte: new Date() } },
      { readingTime: { lte: db.meterReading.fields.createdAt } },
      { OR: [
        { source: 'MANUAL' },
        { notes: null },
        { notes: { not: { startsWith: LEGACY_ANOMALY_PREFIX } } },
      ] },
    ],
  };
}

export function hasLegacySimulationNote(source: string, notes?: string | null): boolean {
  return source === 'DEVICE' && notes?.startsWith(LEGACY_ANOMALY_PREFIX) === true;
}

function isRealMeterReading(reading: MeterReading): boolean {
  return reading.source !== 'SIMULATED'
    && !hasLegacySimulationNote(reading.source, reading.notes)
    && !(reading.readingTime > reading.createdAt)
    && !(reading.readingTime > new Date());
}

/**
 * 保留真实读数现有幂等键。若旧模拟或异常记录占用了该键，
 * 真实读数使用确定性的备用键；新模拟读数始终使用独立命名空间。
 */
export async function lookupMeterReading(
  db: ReadingClient,
  meterId: string,
  key: string,
  simulated: boolean,
) {
  let dedupKey = simulated ? `sim:${key}` : key;
  let existing = await db.meterReading.findUnique({ where: { meterId_dedupKey: { meterId, dedupKey } } });
  if (!simulated && existing && !isRealMeterReading(existing)) {
    dedupKey = `real:${key}`;
    existing = await db.meterReading.findUnique({ where: { meterId_dedupKey: { meterId, dedupKey } } });
  }
  return { dedupKey, existing };
}

export const FUTURE_READING_MESSAGE = '读数时间不能晚于服务器接收时间';
