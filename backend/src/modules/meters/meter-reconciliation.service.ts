import { Injectable } from '@nestjs/common';
import type { MeterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NOT_SIMULATED } from './meter-types.constants.js';

export interface ReconcileQuery {
  buildingId?: string;
  /** YYYY-MM */
  period: string;
  meterType?: MeterType;
}

export interface ReconciliationRow {
  meterId: string;
  meterNumber: string;
  meterType: MeterType;
  unitPrice: number;
  roomNumber: string | null;
  publicAreaName: string | null;
  openingReading: number | null;
  closingReading: number | null;
  /** 按读数差算出的用量 */
  readingUsage: number;
  /** 已落库的读数用量合计（同一月内各笔 usage 之和） */
  recordedUsage: number;
  /** 读数交叉核对：差值与落库用量是否一致 */
  readingConsistent: boolean;
  /** 用量 × 单价（分） */
  readingAmount: number;
  /** 该表当月实际产生的扣费与账单金额（分） */
  chargedAmount: number;
  billAmount: number;
  /** 差额 = 扣费 + 账单 − 应收；0 表示对平 */
  difference: number;
  issues: string[];
}

/**
 * 水电对账（T218，docs/00 §2.2「水电对账」）。
 *
 * 三方交叉核对同一块表在同一账期内：
 *  1. **读数**：当月末读数 − 月初读数，与逐笔读数的 usage 合计是否一致（乱序/补录会暴露）
 *  2. **扣费**：该表读数关联的预付账户扣费流水合计
 *  3. **账单**：该表读数关联的 UTILITY 补缴账单合计
 * 应收 = 用量 × 单价。任意两项不等都会列出 `issues`，`difference != 0` 时高亮。
 *
 * 只读、不修改任何数据；模拟读数不计入（与结算口径一致）。
 */
@Injectable()
export class MeterReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(query: ReconcileQuery) {
    const { start, end } = monthRange(query.period);
    const where: Prisma.MeterWhereInput = { isActive: true };
    if (query.buildingId) where.buildingId = query.buildingId;
    if (query.meterType) where.meterType = query.meterType;

    const meters = await this.prisma.meter.findMany({
      where,
      orderBy: [{ meterType: 'asc' }, { meterNumber: 'asc' }],
      select: {
        id: true,
        meterNumber: true,
        meterType: true,
        unitPrice: true,
        room: { select: { roomNumber: true } },
        publicArea: { select: { name: true } },
      },
    });
    if (meters.length === 0) {
      return { period: query.period, rows: [], summary: emptySummary() };
    }

    const meterIds = meters.map((meter) => meter.id);
    const readings = await this.prisma.meterReading.findMany({
      where: { meterId: { in: meterIds }, readingTime: { gte: start, lt: end }, source: { not: NOT_SIMULATED } },
      orderBy: [{ meterId: 'asc' }, { readingTime: 'asc' }],
      select: { id: true, meterId: true, currentReading: true, usage: true },
    });

    const readingsByMeter = groupBy(readings, (reading) => reading.meterId);

    const rows: ReconciliationRow[] = [];
    for (const meter of meters) {
      const meterReadings = readingsByMeter.get(meter.id) ?? [];
      const opening = meterReadings.length ? Number(meterReadings[0].currentReading) : null;
      const closing = meterReadings.length ? Number(meterReadings[meterReadings.length - 1].currentReading) : null;
      const readingUsage = opening !== null && closing !== null ? round2(closing - opening) : 0;
      const recordedUsage = round2(meterReadings.reduce((sum, reading) => sum + Number(reading.usage), 0));

      const readingIds = meterReadings.map((reading) => reading.id);
      const deductions = readingIds.length
        ? await this.prisma.prepayTransaction.findMany({
            where: { relatedType: 'METER_READING', relatedId: { in: readingIds } },
            select: { amount: true },
          })
        : [];

      const chargedAmount = Math.abs(deductions.reduce((sum, item) => sum + item.amount, 0));
      const billAmount = await this.sumUtilityBillsForReadings(readingIds);
      const readingAmount = Math.round(readingUsage * meter.unitPrice);
      const difference = chargedAmount + billAmount - readingAmount;

      const issues: string[] = [];
      if (meterReadings.length < 2) issues.push('本月读数不足两笔，无法核对');
      if (meterReadings.length >= 2 && Math.abs(readingUsage - recordedUsage) > 0.01) {
        issues.push(`读数差值 ${readingUsage} 与落库用量 ${recordedUsage} 不一致`);
      }
      if (difference !== 0) issues.push(`扣费+账单 ${chargedAmount + billAmount} 分 ≠ 应收 ${readingAmount} 分`);

      rows.push({
        meterId: meter.id,
        meterNumber: meter.meterNumber,
        meterType: meter.meterType,
        unitPrice: meter.unitPrice,
        roomNumber: meter.room?.roomNumber ?? null,
        publicAreaName: meter.publicArea?.name ?? null,
        openingReading: opening,
        closingReading: closing,
        readingUsage,
        recordedUsage,
        readingConsistent: Math.abs(readingUsage - recordedUsage) <= 0.01,
        readingAmount,
        chargedAmount,
        billAmount,
        difference,
        issues,
      });
    }

    return { period: query.period, rows, summary: summarize(rows) };
  }

  /** 读取快照中记录了 readingId 的 UTILITY 账单 */
  private async sumUtilityBillsForReadings(readingIds: string[]): Promise<number> {
    if (readingIds.length === 0) return 0;
    const bills = await this.prisma.$queryRaw<{ total: bigint | null }[]>`
      SELECT COALESCE(SUM("amount"), 0)::bigint AS total
      FROM "bills"
      WHERE "billType" = 'UTILITY'
        AND "snapshot"->>'readingId' = ANY(${readingIds})
    `;
    return Number(bills[0]?.total ?? 0);
  }
}

function summarize(rows: ReconciliationRow[]) {
  return {
    meters: rows.length,
    withIssues: rows.filter((row) => row.issues.length > 0).length,
    totalReadingAmount: rows.reduce((sum, row) => sum + row.readingAmount, 0),
    totalChargedAmount: rows.reduce((sum, row) => sum + row.chargedAmount, 0),
    totalBillAmount: rows.reduce((sum, row) => sum + row.billAmount, 0),
    totalDifference: rows.reduce((sum, row) => sum + row.difference, 0),
  };
}

function emptySummary() {
  return { meters: 0, withIssues: 0, totalReadingAmount: 0, totalChargedAmount: 0, totalBillAmount: 0, totalDifference: 0 };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function monthRange(period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}
