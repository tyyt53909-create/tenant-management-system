import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { randomHex } from '../../common/utils/secure-random.js';
import { SettleMeterBatchDto, SettleMeterDto } from './dto/settle-meter.dto.js';
import type { MeterBatchSettlementItemDto, MeterSettlementResultDto } from './dto/settle-meter-result.dto.js';
import { METER_TYPE_LABEL } from './meter-types.constants.js';
import { MeterPriceService } from './meter-price.service.js';
import { findEarliestRealReading, findMeterSettlementCursor, lockMeters, markMeterReadingSettled, METER_WRITE_TRANSACTION } from './meter-settlement-state.js';
import { resolveMeterUsageOwner } from './meter-usage-attribution.js';
import { hasReservedReadingMarker } from './meter-dedup.util.js';
import { quoteMeterInterval, type MeterIntervalQuote } from './meter-interval-quote.js';
import { realMeterReadings } from './meter-reading-scope.js';

const OCCUPANCY_UNCERTAIN = {
  reasonCode: 'OCCUPANCY_UNCERTAIN',
  reason: '读数区间的租住归属不明确，已保留读数并暂停扣费',
  retryCondition: '核对入住及退租交接时间和表计读数，按可确认的区间截止时间分段重试',
} as const;

const VACANT_INTERVAL = {
  reasonCode: 'VACANT_INTERVAL',
  reason: '读数区间为已确认空置期，用量单独留存',
} as const;

class NoMeterReadingsException extends BadRequestException {
  constructor() {
    super('该水电表在指定结算时间前无任何读数记录');
  }
}

type MeterSettlement = MeterSettlementResultDto & {
  deduction?: Awaited<ReturnType<MeterBillingService['applyReadingDeduction']>>
    | { applied: false; reason: string };
};

@Injectable()
export class MeterBillingService {
  /** 时钟与计价服务必填（QLT-02 / T288），缺失即启动失败而不是静默降级。 */
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
    private readonly priceService: MeterPriceService,
  ) {}

  /**
   * 讀數扣費：用量 × 生效單價
   * - 可归属合同 + 預付帳戶：先扣盡可用餘額（條件更新防並發），差額 → UTILITY 補繳帳單
   * - 归属不明或缺账户时阻断；空置期、公区及零用量无租客扣费。
   *
   * `unitPrice` 由調用方按讀數業務日期解析後傳入（T274）；缺省時退回表上當前價，
   * 保持既有單元測試與舊調用方可編譯。
   */
  async applyReadingDeduction(
    tx: Prisma.TransactionClient,
    meter: { id: string; meterType: string; meterNumber: string; unitPrice: number; roomId: string | null },
    reading: { id: string; readingTime: Date },
    usage: number,
    operatorId: string,
    baseline: { id: string; readingTime: Date } | null,
    unitPrice = meter.unitPrice,
    quote?: MeterIntervalQuote,
  ) {
    if (!meter.roomId) {
      return { applied: false as const, reasonCode: 'PUBLIC_AREA' as const, reason: '公共区域表按运营成本处理，不扣费', unitPrice };
    }

    if (usage <= 0) {
      return { applied: false as const, reasonCode: 'ZERO_USAGE' as const, reason: '用量为 0，无扣费', unitPrice };
    }

    const owner = await resolveMeterUsageOwner(tx, this.clock, meter.roomId, baseline?.readingTime, reading.readingTime);
    if (owner.kind === 'VACANT') {
      return { applied: false as const, ...VACANT_INTERVAL, unitPrice };
    }
    if (owner.kind !== 'TENANT' || !baseline) {
      return { applied: false as const, ...OCCUPANCY_UNCERTAIN, unitPrice };
    }

    const amount = quote?.amount ?? Math.round(usage * unitPrice);
    if (amount <= 0) {
      return { applied: false as const, reasonCode: 'ZERO_CHARGE' as const, reason: '应收金额为 0，无扣费', unitPrice };
    }

    const account = await tx.prepayAccount.findUnique({
      where: { tenantId_roomId: { tenantId: owner.tenantId, roomId: meter.roomId } },
    });
    if (!account) {
      return {
        applied: false as const,
        reasonCode: 'MISSING_PREPAY_ACCOUNT' as const,
        reason: '该房间租客无预付账户，未扣费',
        retryCondition: '为该房间及合同租客开立预付账户，核对费用归属后重试',
        unitPrice,
      };
    }

    // 先扣盡可用餘額（條件更新防並發透支）
    let deducted = 0;
    if (account.balanceCache > 0) {
      const candidate = Math.min(account.balanceCache, amount);
      const result = await tx.prepayAccount.updateMany({
        where: { id: account.id, balanceCache: { gte: candidate } },
        data: { balanceCache: { decrement: candidate } },
      });
      deducted = result.count > 0 ? candidate : 0;
    }

    let prepayTransaction = null;
    if (deducted > 0) {
      const updatedAccount = await tx.prepayAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      const typeLabel = METER_TYPE_LABEL[meter.meterType] ?? '水电费';
      prepayTransaction = await tx.prepayTransaction.create({
        data: {
          accountId: account.id,
          type: 'DEDUCTION',
          amount: -deducted,
          balanceAfter: updatedAccount.balanceCache,
          relatedId: reading.id,
          relatedType: 'METER_READING',
          description: `${this.formatPeriod(reading.readingTime)} ${typeLabel}扣费（${meter.meterNumber}）`,
          operatorId,
        },
      });
    }

    const shortfall = amount - deducted;
    let bill = null;
    if (shortfall > 0) {
      const dueDate = this.clock.addDays(this.clock.todayUtc(reading.readingTime), 7);

      bill = await tx.bill.create({
        data: {
          contractId: owner.contractId,
          billNumber: `B${Date.now()}${randomHex(3)}`,
          billType: 'UTILITY',
          period: this.formatPeriod(reading.readingTime),
          amount: shortfall,
          dueDate,
          snapshot: {
            meterId: meter.id,
            meterNumber: meter.meterNumber,
            meterType: meter.meterType,
            readingId: reading.id,
            baselineReadingId: baseline.id,
            intervalStart: baseline.readingTime.toISOString(),
            intervalEnd: reading.readingTime.toISOString(),
            usage,
            unitPrice: quote?.segments.some((segment) => segment.usage > 0 && segment.unitPrice !== unitPrice) ? null : unitPrice,
            ...(quote?.segments.length && { segments: quote.segments.map((segment) => ({ ...segment })) }),
            totalAmount: amount,
            deducted,
            shortfall,
            reason: '预付账户余额不足，补缴差额',
          },
        },
      });
    }

    return { applied: true as const, contractId: owner.contractId, amount, deducted, shortfall, prepayTransaction, bill, unitPrice };
  }

  private formatPeriod(date: Date): string {
    return this.clock.monthKey(date);
  }

  /**
   * 查看水电表未结算用量与预估金额（预览）
   */
  async getUnsettledUsage(meterId: string, settleUntilStr?: string, db: Prisma.TransactionClient = this.prisma) {
    const meter = await db.meter.findUnique({
      where: { id: meterId },
      include: { room: { select: { roomNumber: true } } },
    });
    if (!meter) throw new NotFoundException('水电表不存在');

    const now = this.clock.now();
    const settleUntil = settleUntilStr ? new Date(Math.min(now.getTime(), Date.parse(settleUntilStr))) : now;

    const latestReading = await db.meterReading.findFirst({
      where: {
        meterId,
        readingTime: { lte: settleUntil },
        ...realMeterReadings(db),
      },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });

    if (!latestReading) {
      return {
        meterId,
        unsettledUsage: 0,
        estimatedAmount: 0,
        lastSettledReading: 0,
        lastSettledTime: null,
        currentReading: 0,
        readingTime: null,
        hasReadings: false as const,
      };
    }

    const lastSettledReading = await findMeterSettlementCursor(db, meterId);

    if (lastSettledReading && (
      lastSettledReading.id === latestReading.id || lastSettledReading.readingTime > latestReading.readingTime
    )) {
      return {
        meterId,
        unsettledUsage: 0,
        estimatedAmount: 0,
        lastSettledReading: Number(lastSettledReading.currentReading),
        lastSettledTime: lastSettledReading.readingTime,
        currentReading: Number(latestReading.currentReading),
        readingTime: latestReading.readingTime,
        alreadySettled: true as const,
        hasReadings: true as const,
      };
    }

    const baseline = lastSettledReading ?? await findEarliestRealReading(db, meterId);
    const baselineVal = Number(baseline?.currentReading ?? 0);
    const currentVal = Number(latestReading.currentReading);
    const quote = await quoteMeterInterval(db, this.priceService, meter, baseline, latestReading, Math.max(0, Math.round((currentVal - baselineVal) * 100) / 100));
    const blocked = 'reasonCode' in quote;
    const unsettledUsage = blocked ? 0 : quote.usage;
    const owner = !blocked && meter.roomId && unsettledUsage > 0
      ? await resolveMeterUsageOwner(db, this.clock, meter.roomId, baseline?.readingTime, latestReading.readingTime)
      : null;

    let prepayBalance: number | null = null;
    if (meter.roomId && owner?.kind === 'TENANT') {
      const account = await db.prepayAccount.findUnique({
        where: { tenantId_roomId: { tenantId: owner.tenantId, roomId: meter.roomId } },
      });
      prepayBalance = account?.balanceCache ?? null;
    }

    return {
      meterId,
      meterNumber: meter.meterNumber,
      meterType: meter.meterType,
      ...(blocked ? { settlementBlock: quote } : { unitPrice: quote.unitPrice, segments: quote.segments }),
      roomNumber: meter.room?.roomNumber || '公共区域',
      tenantName: owner?.kind === 'TENANT' ? owner.tenantName : null,
      contractId: owner?.kind === 'TENANT' ? owner.contractId : null,
      baselineReadingId: baseline?.id ?? null,
      attribution: owner?.kind === 'UNKNOWN' ? OCCUPANCY_UNCERTAIN
        : owner?.kind === 'VACANT' ? VACANT_INTERVAL : undefined,
      prepayBalance,
      lastSettledReading: baselineVal,
      lastSettledTime: lastSettledReading?.readingTime ?? null,
      currentReading: currentVal,
      readingTime: latestReading.readingTime,
      unsettledUsage,
      estimatedAmount: blocked || owner?.kind === 'VACANT' ? 0 : quote.amount,
      targetReadingId: latestReading.id,
      alreadySettled: false as const,
      hasReadings: true as const,
    };
  }

  /**
   * 周期结算指定水电表（采集与结算拆分）
   * 结算上次结算（或初始底数）至截止时间之间的累计用量，生成统一扣费流水或补缴账单
   *
   * T274：
   * - 事务内 `SELECT ... FOR UPDATE` 锁表行，并发结算串行化；
   * - 生效单价按读数业务日期解析，不再用「当前价」重算历史；
   * - 结算结果结构化落库（settledAt/Usage/UnitPrice/Amount），重复结算幂等。
   */
  async settleMeter(meterId: string, dto: SettleMeterDto, operatorId: string): Promise<MeterSettlement> {
    if (hasReservedReadingMarker(dto.notes)) {
      throw new BadRequestException('结算备注不得包含系统保留标记');
    }
    const now = this.clock.now();
    const settleUntil = dto.settleUntil ? new Date(Math.min(now.getTime(), Date.parse(dto.settleUntil))) : now;

    return this.prisma.$transaction(
      (tx) => this.settleMeterInTransaction(tx, meterId, settleUntil, operatorId, dto.notes),
      METER_WRITE_TRANSACTION,
    );
  }

  /** Executes against the caller's transaction so the financial result and its work item commit together. */
  async settleMeterInTransaction(
    tx: Prisma.TransactionClient, meterId: string, settleUntil: Date, operatorId: string, notes?: string,
  ): Promise<MeterSettlement> {
    await lockMeters(tx, [meterId]);

    const meter = await tx.meter.findUnique({ where: { id: meterId } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const latestReading = await tx.meterReading.findFirst({
      where: {
        meterId,
        readingTime: { lte: settleUntil },
        ...realMeterReadings(tx),
      },
      orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
    });

    if (!latestReading) {
      throw new NoMeterReadingsException();
    }

    const lastSettledReading = await findMeterSettlementCursor(tx, meterId);

    if (lastSettledReading && (
      lastSettledReading.id === latestReading.id || lastSettledReading.readingTime > latestReading.readingTime
    )) {
      return {
        meterId,
        settled: false,
        status: 'NO_CHANGE',
        reasonCode: 'ALREADY_SETTLED',
        usage: 0,
        amount: 0,
        reason: lastSettledReading.id === latestReading.id
          ? '最新读数已结算，无新增未结算用量'
          : '截止时间内的用量已结算，无新增未结算用量',
      };
    }

    const baseline = lastSettledReading ?? await findEarliestRealReading(tx, meterId);
    const baselineVal = Number(baseline?.currentReading ?? 0);

    const currentVal = Number(latestReading.currentReading);
    const quote = await quoteMeterInterval(tx, this.priceService, meter, baseline, latestReading, Math.max(0, Math.round((currentVal - baselineVal) * 100) / 100));
    if ('reasonCode' in quote) {
      return { meterId, status: 'BLOCKED', settled: false, usage: 0, amount: 0, ...quote };
    }
    const { usage, unitPrice, amount, segments } = quote;

    if (usage <= 0) {
      await markMeterReadingSettled(tx, latestReading, 0, unitPrice, 0, notes, false, segments);
      return {
        meterId,
        settled: true,
        status: 'NO_CHANGE',
        reasonCode: 'ZERO_USAGE',
        reason: '周期内累计用量为 0',
        usage: 0,
        amount: 0,
        unitPrice,
        deduction: { applied: false as const, reason: '周期内累计用量为 0' },
      };
    }

    const deduction = await this.applyReadingDeduction(
      tx,
      meter,
      latestReading,
      usage,
      operatorId,
      baseline,
      unitPrice,
      quote,
    );

    if (!deduction.applied) {
      const vacancy = deduction.reasonCode === 'VACANT_INTERVAL';
      if (vacancy) {
        await markMeterReadingSettled(tx, latestReading, usage, unitPrice, 0, notes, true, segments);
      }
      return {
        meterId,
        settled: vacancy,
        status: deduction.retryCondition ? 'BLOCKED' : 'NO_CHANGE',
        reasonCode: deduction.reasonCode,
        retryCondition: deduction.retryCondition,
        baselineReading: baselineVal,
        currentReading: currentVal,
        usage,
        amount: vacancy ? 0 : amount,
        unitPrice,
        deduction,
        reason: deduction.reason,
      };
    }

    const settledAmount =
      (deduction.deducted ?? 0) + (deduction.shortfall ?? 0);
    await markMeterReadingSettled(tx, latestReading, usage, unitPrice, settledAmount, notes, false, segments);

    return {
      meterId,
      settled: true,
      status: 'SETTLED',
      reasonCode: 'SETTLED',
      billId: deduction.bill?.id,
      contractId: deduction.contractId,
      prepayTransactionId: deduction.prepayTransaction?.id,
      baselineReading: baselineVal,
      currentReading: currentVal,
      usage,
      amount,
      unitPrice: segments.some((segment) => segment.usage > 0 && segment.unitPrice !== unitPrice) ? undefined : unitPrice,
      segments,
      deduction,
    };

  }

  /**
   * 批量周期结算（如按楼栋或表列表）
   */
  async settleBatch(
    dto: SettleMeterBatchDto,
    operatorId: string,
    settleMeterFn?: MeterBillingService['settleMeter'],
  ) {
    if (hasReservedReadingMarker(dto.notes)) {
      throw new BadRequestException('结算备注不得包含系统保留标记');
    }
    let meterIds = dto.meterIds;
    if (!meterIds || meterIds.length === 0) {
      const where: Prisma.MeterWhereInput = { isActive: true };
      if (dto.buildingId) where.buildingId = dto.buildingId;
      const meters = await this.prisma.meter.findMany({ where, select: { id: true } });
      meterIds = meters.map((m) => m.id);
    }

    const settle = settleMeterFn ?? ((id: string, d: SettleMeterDto, op: string) => this.settleMeter(id, d, op));
    const results: Array<MeterBatchSettlementItemDto & Pick<MeterSettlement, 'deduction'>> = [];
    const now = this.clock.now();
    const settleUntil = dto.settleUntil && new Date(dto.settleUntil) <= now ? dto.settleUntil : now.toISOString();
    for (const id of meterIds) {
      try {
        const result = await settle(id, { settleUntil, notes: dto.notes }, operatorId);
        results.push(Object.assign({ success: result.status === 'SETTLED' }, result));
      } catch (err: unknown) {
        const noReadings = err instanceof NoMeterReadingsException;
        const missingMeter = err instanceof NotFoundException;
        const reason = noReadings || missingMeter ? err.message : '结算执行失败';
        results.push({
          meterId: id,
          status: noReadings ? 'BLOCKED' : 'FAILED',
          reasonCode: noReadings ? 'NO_READINGS' : missingMeter ? 'METER_NOT_FOUND' : 'SETTLEMENT_FAILED',
          settled: false,
          success: false,
          usage: 0,
          amount: 0,
          reason,
          error: reason,
          retryCondition: noReadings ? '补录截止时间内的有效读数后重试'
            : missingMeter ? '核对水电表编号后重试' : '排查并排除结算故障后重试',
        });
      }
    }

    const counts = { SETTLED: 0, NO_CHANGE: 0, BLOCKED: 0, FAILED: 0 };
    for (const result of results) counts[result.status] += 1;

    return {
      settleUntil,
      total: results.length,
      settledCount: counts.SETTLED,
      noChangeCount: counts.NO_CHANGE,
      blockedCount: counts.BLOCKED,
      failedCount: counts.FAILED,
      successCount: counts.SETTLED,
      failureCount: counts.BLOCKED + counts.FAILED,
      results,
    };
  }
}
