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
import { type MeterIntervalQuote, type IntervalReading } from './meter-interval-quote.js';
import { realMeterReadings } from './meter-reading-scope.js';
import { reviewMeterCharge } from './utility-charge-plan.js';
import { createHash } from 'node:crypto';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';

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

  previewCharge(meterId: string, settleUntil?: string) {
    return this.prisma.$transaction(async (tx) => ({
      ...await this.getUnsettledUsage(meterId, settleUntil, tx), financialEffect: 'NONE' as const,
    }), { isolationLevel: 'RepeatableRead' });
  }

  async charge(id: string) {
    const charge = await this.prisma.utilityCharge.findUnique({ where: { id } });
    if (!charge) throw new NotFoundException('费用不存在');
    return charge;
  }

  /** Shared read-only quotation; confirmed responsibility and immutable policies are mandatory. */
  quoteInterval(tx: Prisma.TransactionClient, meter: Parameters<typeof reviewMeterCharge>[3], baseline: IntervalReading | null, target: IntervalReading) {
    return reviewMeterCharge(tx, this.clock, this.priceService, meter, baseline, target);
  }

  /** Caller owns room/meter locks and the transaction. Re-read the account under its row lock. */
  async applyReadingDeduction(
    tx: Prisma.TransactionClient,
    meter: { id: string; meterType: string; meterNumber: string; unitPrice: number; roomId: string | null },
    reading: IntervalReading & { source?: string }, _usage: number, operatorId: string,
    baseline: IntervalReading | null, _unitPrice = meter.unitPrice, _quote?: MeterIntervalQuote,
  ) {
    // These rows come from the caller's locked real-reading query or real-reading insert.
    // Never quote from the cached previousReading/usage fields supplied by old importers.
    const actualMeter = meter as Parameters<typeof reviewMeterCharge>[3];
    const target = reading;
    const opening = baseline;
    if (reading.source === 'SIMULATED' || reading.readingTime > this.clock.now()) throw apiError(ErrorCode.UTILITY_RULE_BLOCKED, '正式计费只接受有效真实读数');
    let plan = await this.quoteInterval(tx, actualMeter, opening, target);
    if ('reasonCode' in plan) return { applied: false as const, ...plan, unitPrice: meter.unitPrice };
    if (plan.account) {
      await tx.$queryRaw`SELECT id FROM prepay_accounts WHERE id = ${plan.account.id} FOR UPDATE`;
      plan = await this.quoteInterval(tx, actualMeter, opening, target);
      if ('reasonCode' in plan) return { applied: false as const, ...plan, unitPrice: meter.unitPrice };
    }
    const { amount, prepayApplied: deducted, receivableAmount: shortfall, providerAmount, responsibility, policy, account } = plan;
    let prepayTransaction = null;
    if (deducted > 0 && account) {
      const updated = await tx.prepayAccount.update({ where: { id: account.id }, data: { balanceCache: { decrement: deducted } } });
      prepayTransaction = await tx.prepayTransaction.create({ data: {
        accountId: account.id, type: 'DEDUCTION', amount: -deducted, balanceAfter: updated.balanceCache,
        relatedId: target.id, relatedType: 'METER_READING',
        description: `${this.clock.monthKey(target.readingTime)} ${METER_TYPE_LABEL[meter.meterType] ?? '水电费'}扣费（${meter.meterNumber}）`, operatorId,
      } });
    }
    const snapshot = {
      meterId: meter.id, meterNumber: meter.meterNumber, meterType: meter.meterType,
      readingId: target.id, baselineReadingId: opening!.id,
      intervalStart: opening!.readingTime.toISOString(), intervalEnd: target.readingTime.toISOString(),
      usage: plan.usage, unitPrice: Number.isInteger(plan.unitPrice) && !plan.segments.some((segment) => segment.unitPrice !== plan.unitPrice) ? plan.unitPrice : null,
      segments: plan.segments.map((segment) => ({ ...segment })),
      policyVersions: plan.policies.map((p) => ({ id: p.id, version: p.version, rateCents: p.rateCents.toString(), effectiveFrom: p.effectiveFrom.toISOString(), evidence: p.evidence })),
      responsibility: { id: responsibility.id, contractId: responsibility.contractId, tenantId: responsibility.tenantId, evidence: responsibility.evidence },
      responsibilityIntervals: plan.responsibilities.map((r) => ({ id: r.id, startAt: r.startAt.toISOString(), endAt: r.endAt?.toISOString() ?? null, evidence: r.evidence })),
      collectionMode: plan.collectionMode, totalAmount: amount, deducted, shortfall, providerAmount,
      reason: plan.collectionMode === 'PREPAY_WITH_SHORTFALL' ? '预付账户抵扣及差额补缴' : plan.collectionMode === 'POSTPAID' ? '后付全额应收' : plan.collectionMode === 'DIRECT_TO_PROVIDER' ? '直缴供应商参考费用，不产生房东应收' : '已确认空置用量',
    };
    const bill = shortfall > 0 ? await tx.bill.create({ data: {
      contractId: responsibility.contractId!, billNumber: `B${Date.now()}${randomHex(3)}`, billType: 'UTILITY',
      period: this.clock.monthKey(target.readingTime), amount: shortfall,
      dueDate: this.clock.addDays(this.clock.todayUtc(target.readingTime), 7), snapshot,
      dedupKey: `UTILITY:METER:${meter.id}:${opening!.id}:${target.id}`,
    } }) : null;
    const charge = await tx.utilityCharge.create({ data: {
      meterId: meter.id, roomId: actualMeter.roomId!, contractId: responsibility.contractId, tenantId: responsibility.tenantId,
      responsibilityIntervalId: responsibility.id, policyVersionId: policy?.id ?? null,
      baselineReadingId: opening!.id, targetReadingId: target.id, startAt: opening!.readingTime, endAt: target.readingTime,
      collectionMode: plan.collectionMode, usage: plan.usage, totalAmount: amount, prepayApplied: deducted,
      receivableAmount: shortfall, providerAmount, billId: bill?.id, prepayTransactionId: prepayTransaction?.id, snapshot, operatorId,
      notificationState: responsibility.tenantId ? 'PENDING' : 'NOT_REQUIRED',
    } });
    return { applied: true as const, reason: undefined, retryCondition: undefined, reasonCode: responsibility.responsibility === 'OWNER' ? 'VACANT_INTERVAL' as const : 'SETTLED' as const,
      contractId: responsibility.contractId ?? undefined, amount, usage: plan.usage, deducted, shortfall, providerAmount, collectionMode: plan.collectionMode,
      prepayTransaction, bill, chargeId: charge.id, unitPrice: plan.unitPrice, segments: plan.segments };
  }

  /** A response-loss retry replays the original result, including already-processed items. */
  async confirmCharge(meterId: string, dto: { requestId: string; reviewToken: string; settleUntil?: string }, operatorId: string) {
    const payloadHash = digest([meterId, dto.reviewToken, dto.settleUntil ?? null]);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT true FROM pg_advisory_xact_lock(hashtextextended(${dto.requestId}, 0))`;
      const existing = await tx.utilityPostingConfirmation.findUnique({ where: { requestId: dto.requestId } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw apiError(ErrorCode.IDEMPOTENCY_CONFLICT);
        return existing.result;
      }
      await lockMeters(tx, [meterId]);
      const preview = await this.getUnsettledUsage(meterId, dto.settleUntil, tx);
      if (!('reviewToken' in preview) || preview.reviewToken !== dto.reviewToken) throw apiError(ErrorCode.PREVIEW_STALE);
      if ('settlementBlock' in preview && preview.settlementBlock) throw apiError(ErrorCode.UTILITY_RULE_BLOCKED, preview.settlementBlock.reason);
      const now = this.clock.now();
      const result = await this.settleMeterInTransaction(tx, meterId, dto.settleUntil ? new Date(Math.min(now.getTime(), Date.parse(dto.settleUntil))) : now, operatorId);
      await tx.utilityPostingConfirmation.create({ data: { requestId: dto.requestId, payloadHash, result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue, confirmedBy: operatorId } });
      return result;
    }, METER_WRITE_TRANSACTION);
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
    const quote = await this.quoteInterval(db, meter, baseline, latestReading);
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
      ...(!blocked && { collectionMode: quote.collectionMode, prepayApplied: quote.prepayApplied, receivableAmount: quote.receivableAmount, providerAmount: quote.providerAmount }),
      reviewToken: digest([meter, baseline, latestReading, quote]),
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
    const quote = await this.quoteInterval(tx, meter, baseline, latestReading);
    if ('reasonCode' in quote) {
      return { meterId, status: 'BLOCKED', settled: false, usage: 0, amount: 0, ...quote };
    }
    const { usage, unitPrice, amount, segments } = quote;

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
      return {
        meterId,
        settled: false,
        status: 'BLOCKED',
        reasonCode: deduction.reasonCode,
        retryCondition: deduction.retryCondition,
        baselineReading: baselineVal,
        currentReading: currentVal,
        usage,
        amount,
        unitPrice,
        deduction,
        reason: deduction.reason,
      };
    }

    const settledAmount =
      deduction.amount;
    await markMeterReadingSettled(tx, latestReading, usage, unitPrice, settledAmount, notes, deduction.reasonCode === 'VACANT_INTERVAL', segments);

    return {
      meterId,
      settled: true,
      status: deduction.reasonCode === 'VACANT_INTERVAL' || usage === 0 ? 'NO_CHANGE' : 'SETTLED',
      reasonCode: deduction.reasonCode === 'VACANT_INTERVAL' ? 'VACANT_INTERVAL' : usage === 0 ? 'ZERO_USAGE' : 'SETTLED',
      chargeId: deduction.chargeId,
      collectionMode: deduction.collectionMode ?? undefined,
      prepayApplied: deduction.deducted, receivableAmount: deduction.shortfall, providerAmount: deduction.providerAmount,
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

function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
