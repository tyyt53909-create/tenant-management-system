import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MeterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { getBusinessParts, parseDateOnly } from '../../common/business-clock/business-clock.js';

/** 计价只需要表的这三个字段，允许调用方用 select 裁掉其余列。 */
export interface MeterPriceInput {
  id: string;
  meterType: MeterType;
  unitPrice: number;
}

export interface MeterPriceRow {
  meterId: string | null;
  meterType: MeterType;
  unitPrice: number;
  effectiveDate: Date;
  createdAt: Date;
}

type PriceDb = Pick<PrismaService, 'meterPriceHistory'> | Prisma.TransactionClient;

/**
 * 单价解析（FIN-08 / T274）。
 *
 * 取价规则：`effectiveDate <= 业务日期` 的最新一条
 *   1. 该表的调价记录（meterId = 表 id）
 *   2. 该表类型的默认价（meterId 为空）
 *   3. `Meter.unitPrice`（历史数据兜底）
 *
 * 业务日期一律经 `BusinessClock.todayUtc()` 归一到 UTC 零点，
 * 与 `@db.Date` 的 effectiveDate 同口径，避免时区把 00:00 推到前一天。
 */
@Injectable()
export class MeterPriceService {
  private readonly clock: BusinessClock;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() clock?: BusinessClock,
  ) {
    this.clock = clock ?? new BusinessClock(new ConfigService());
  }

  /** 单表取价；db 可传事务客户端以保证读到自己刚写入的历史。 */
  async resolveUnitPrice(
    meter: MeterPriceInput,
    at: Date,
    db: PriceDb = this.prisma,
  ): Promise<number> {
    const book = await this.loadPriceBook([meter], db);
    return book.priceFor(meter, at);
  }

  /**
   * 批量加载价格簿：一次查询覆盖所有表的调价记录与类型默认价。
   * 统计、对账、导出等按读数逐笔计价的场景必须用它，避免 N+1。
   */
  async loadPriceBook(meters: MeterPriceInput[], db: PriceDb = this.prisma): Promise<MeterPriceBook> {
    if (meters.length === 0) return new MeterPriceBook(new Map(), new Map());

    const meterIds = [...new Set(meters.map((meter) => meter.id))];
    const meterTypes = [...new Set(meters.map((meter) => meter.meterType))];

    const rows = await db.meterPriceHistory.findMany({
      where: {
        meterType: { in: meterTypes },
        OR: [{ meterId: { in: meterIds } }, { meterId: null }],
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        meterId: true,
        meterType: true,
        unitPrice: true,
        effectiveDate: true,
        createdAt: true,
      },
    });

    const byMeter = new Map<string, MeterPriceRow[]>();
    const byType = new Map<MeterType, MeterPriceRow[]>();
    for (const row of rows) {
      if (row.meterId) {
        const list = byMeter.get(row.meterId) ?? [];
        list.push(row);
        byMeter.set(row.meterId, list);
      } else {
        const list = byType.get(row.meterType) ?? [];
        list.push(row);
        byType.set(row.meterType, list);
      }
    }

    return new MeterPriceBook(byMeter, byType, this.clock.timeZone);
  }

  /**
   * 记录一次调价。同一生效日重复提交视为修正，不新增重复行。
   * 返回最终落库的记录。
   */
  async recordPriceChange(
    tx: Prisma.TransactionClient,
    input: {
      meterId?: string | null;
      meterType: MeterType;
      unitPrice: number;
      effectiveDate: Date | string;
      createdBy: string;
    },
  ) {
    const effectiveDate = this.toDateOnly(input.effectiveDate);
    const meterId = input.meterId ?? null;

    const existing = await tx.meterPriceHistory.findFirst({
      where: { meterId, meterType: input.meterType, effectiveDate },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      if (existing.unitPrice === input.unitPrice) return existing;
      return tx.meterPriceHistory.update({
        where: { id: existing.id },
        data: { unitPrice: input.unitPrice, createdBy: input.createdBy },
      });
    }

    return tx.meterPriceHistory.create({
      data: {
        meterId,
        meterType: input.meterType,
        unitPrice: input.unitPrice,
        effectiveDate,
        createdBy: input.createdBy,
      },
    });
  }

  /** 某块表可见的价格历史：自己的调价 + 类型默认价，按生效日倒序。 */
  async history(meterId: string) {
    const meter = await this.prisma.meter.findUnique({
      where: { id: meterId },
      select: { id: true, meterType: true, unitPrice: true, priceEffectiveDate: true },
    });
    if (!meter) return null;

    const rows = await this.prisma.meterPriceHistory.findMany({
      where: {
        meterType: meter.meterType,
        OR: [{ meterId }, { meterId: null }],
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        meterId: true,
        meterType: true,
        unitPrice: true,
        effectiveDate: true,
        createdBy: true,
        createdAt: true,
      },
    });

    return {
      meter,
      items: rows.map((row) => ({
        ...row,
        scope: row.meterId ? ('METER' as const) : ('TYPE' as const),
      })),
    };
  }

  /** 把字符串/Date 归一为 UTC 零点，和 @db.Date 对齐。 */
  toDateOnly(value: Date | string): Date {
    if (typeof value === 'string') {
      const dateOnly = parseDateOnly(value);
      if (dateOnly) return dateOnly;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`无效的生效日期: ${String(value)}`);
    }
    return businessDayUtc(date, this.clock.timeZone);
  }
}

/** 一次性加载的价格簿，按表/类型分组后做纯函数取价。 */
export class MeterPriceBook {
  constructor(
    private readonly byMeter: Map<string, MeterPriceRow[]>,
    private readonly byType: Map<MeterType, MeterPriceRow[]>,
    private readonly timeZone: string = 'Asia/Shanghai',
  ) {}

  priceFor(meter: MeterPriceInput, at: Date): number {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return meter.unitPrice;
    const day = businessDayUtc(at, this.timeZone);
    const own = latestAtOrBefore(this.byMeter.get(meter.id), day);
    if (own) return own.unitPrice;
    const typeDefault = latestAtOrBefore(this.byType.get(meter.meterType), day);
    if (typeDefault) return typeDefault.unitPrice;
    return meter.unitPrice;
  }
}

function latestAtOrBefore(rows: MeterPriceRow[] | undefined, day: Date): MeterPriceRow | undefined {
  if (!rows || rows.length === 0) return undefined;
  // 不依赖查询顺序：显式取生效日不晚于业务日的最大一条
  let latest: MeterPriceRow | undefined;
  for (const row of rows) {
    if (startOfUtcDay(row.effectiveDate).getTime() > day.getTime()) continue;
    if (!latest || startOfUtcDay(row.effectiveDate).getTime() > startOfUtcDay(latest.effectiveDate).getTime()) {
      latest = row;
    }
  }
  return latest;
}

/** 业务日 → UTC 零点的 @db.Date 口径；不依赖进程本地时区。 */
export function businessDayUtc(date: Date, timeZone: string): Date {
  const { year, month, day } = getBusinessParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
