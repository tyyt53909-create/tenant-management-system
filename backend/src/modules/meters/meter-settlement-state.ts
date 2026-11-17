import { Prisma } from '@prisma/client';
import { isSettledReading } from './meter-dedup.util.js';
import { NOT_SIMULATED } from './meter-types.constants.js';

/** 加锁后的查询必须看见上一事务刚提交的读数和结算状态。 */
export const METER_WRITE_TRANSACTION = { isolationLevel: 'ReadCommitted' } as const;

/** 锁住同一批中的表计后再读写读数，所有入口按数据库 ID 顺序加锁。 */
export async function lockMeters(tx: Prisma.TransactionClient, meterIds: string[]) {
  if (meterIds.length === 0) return;
  await tx.$queryRaw`
    SELECT "id" FROM "meters" WHERE "id" IN (${Prisma.join([...new Set(meterIds)])})
    ORDER BY "id" FOR UPDATE
  `;
}

/** 读取全局结算游标，历史截止时间不会让游标退回旧读数。 */
export async function findMeterSettlementCursor(
  db: Pick<Prisma.TransactionClient, 'meterReading'>,
  meterId: string,
) {
  const reading = await db.meterReading.findFirst({
    where: {
      meterId,
      source: NOT_SIMULATED,
      OR: [
        { settledAt: { not: null } },
        { notes: { contains: '[SETTLED]' } },
        { notes: { contains: '[INITIAL]' } },
      ],
    },
    orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
  });
  return reading && isSettledReading(reading) ? reading : null;
}
