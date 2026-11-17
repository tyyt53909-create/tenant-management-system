import { type Prisma, type Meter } from '@prisma/client';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { quoteMeterInterval, type IntervalReading } from './meter-interval-quote.js';
import { MeterPriceService } from './meter-price.service.js';
import { resolveMeterUsageOwner } from './meter-usage-attribution.js';

export const chargeBlock = (reasonCode: 'LEGACY_REVIEW_REQUIRED' | 'OWNERSHIP_UNRESOLVED' | 'BALANCE_REVIEW_REQUIRED' | 'MISSING_PREPAY_ACCOUNT' | 'UTILITY_COVERAGE_CONFLICT' | 'POLICY_BOUNDARY_REQUIRED' | 'AMOUNT_OUT_OF_RANGE', reason: string, retryCondition: string) =>
  ({ reasonCode, reason, retryCondition });

/** All sources use these immutable policy versions. Meter display prices cannot override consent. */
export async function reviewMeterCharge(
  db: Prisma.TransactionClient, clock: BusinessClock, prices: MeterPriceService,
  meter: Pick<Meter, 'id' | 'roomId' | 'meterType' | 'unitPrice'>,
  baseline: IntervalReading | null, target: IntervalReading,
) {
  if (!meter.roomId || !baseline || target.readingTime > clock.now()) {
    return chargeBlock('OWNERSHIP_UNRESOLVED', '缺少可核验的房间及真实计费边界', '核对真实起终读数与责任归属后重试');
  }
  const intervals = await db.meterResponsibilityInterval.findMany({ where: {
    meterId: meter.id, roomId: meter.roomId, startAt: { lt: target.readingTime },
    OR: [{ endAt: null }, { endAt: { gt: baseline.readingTime } }],
  }, orderBy: { startAt: 'asc' } });
  const first = intervals[0];
  let coveredUntil: Date | null = baseline.readingTime;
  const validCoverage = intervals.length > 0 && intervals.every((row) => {
    if (row.responsibility !== first.responsibility || row.contractId !== first.contractId || row.tenantId !== first.tenantId || (coveredUntil && row.startAt > coveredUntil)) return false;
    coveredUntil = row.endAt;
    return true;
  }) && (!coveredUntil || coveredUntil >= target.readingTime);
  const responsibility = validCoverage ? first : null;
  if (!responsibility) return chargeBlock('OWNERSHIP_UNRESOLVED', '整个用量范围尚无唯一已确认责任段', '核验旧租客退租、新租客入住及空置交接读数，分段确认责任后重试');
  const owner = await resolveMeterUsageOwner(db, clock, meter.roomId, baseline.readingTime, target.readingTime);
  const nominalLease = responsibility.responsibility === 'OWNER' && owner.kind !== 'VACANT' ? await db.contract.findFirst({ where: { roomId: meter.roomId, status: { not: 'DRAFT' }, startDate: { lte: clock.todayUtc(target.readingTime) }, endDate: { gte: clock.todayUtc(baseline.readingTime) } }, select: { id: true } }) : null;
  if (responsibility.responsibility === 'TENANT'
    ? owner.kind !== 'TENANT' || owner.contractId !== responsibility.contractId || owner.tenantId !== responsibility.tenantId
    : owner.kind !== 'VACANT' && (owner.kind === 'TENANT' || Boolean(nominalLease))) {
    return chargeBlock('OWNERSHIP_UNRESOLVED', '已确认责任段与实际交接事实不一致', '核对实际入住、退租及责任范围后重新预览');
  }
  const overlap = await db.utilityCharge.findFirst({ where: { meterId: meter.id, startAt: { lt: target.readingTime }, endAt: { gt: baseline.readingTime } }, select: { id: true } });
  if (overlap) return chargeBlock('UTILITY_COVERAGE_CONFLICT', '该消费范围已有正式费用', '查看原费用及全局游标，历史更正须独立冲正处理');
  const policies = responsibility.contractId ? await db.utilityPolicyVersion.findMany({
    where: { contractId: responsibility.contractId, feeType: meter.meterType, effectiveFrom: { lt: target.readingTime } }, orderBy: { effectiveFrom: 'asc' },
  }) : [];
  const policyAt = (at: Date) => policies.findLast((p) => p.effectiveFrom <= at);
  const policy = policyAt(baseline.readingTime);
  if (responsibility.responsibility === 'TENANT' && !policy) return chargeBlock('LEGACY_REVIEW_REQUIRED', '本合同的收款规则尚未明确确认', '确认收款模式、费率版本及真实生效底数后重试');
  const applicable = policy ? policies.filter((p) => p.id === policy.id || p.effectiveFrom > baseline.readingTime) : [];
  if (applicable.some((p) => p.collectionMode !== policy!.collectionMode || p.calculationMode !== 'METER_DELTA_FLAT_RATE' || p.roundingRule !== 'HALF_UP_CHARGE_V1')) {
    return chargeBlock('POLICY_BOUNDARY_REQUIRED', '该段跨收款模式或包含不支持的规则', '在已确认的生效读数处分段结算');
  }
  const quote = await quoteMeterInterval(db, prices, meter, baseline, target, 0, policy ? {
    priceFor: (_meter, at) => policyAt(at)!.rateCents.toNumber(),
    hasUnpricedHistory: (_meter, at) => !policyAt(at),
    changesBetween: (_meter, start, end) => applicable.filter((p) => p.effectiveFrom > start && p.effectiveFrom < end).map((p) => ({ at: p.effectiveFrom.getTime(), unitPrice: p.rateCents.toNumber(), hasPriorRate: true })),
    exactRateFor: (at) => ({ rateCents: policyAt(at)!.rateCents.toString(), policyVersionId: policyAt(at)!.id }),
  } : undefined);
  if ('reasonCode' in quote) return quote;
  const amount = policy ? quote.amount : 0;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2147483647 || !Number.isSafeInteger(Math.round(quote.usage * 100)) || quote.usage >= 1e12) return chargeBlock('AMOUNT_OUT_OF_RANGE', '费用超出整数分支持范围', '核对读数及已确认费率');
  const account = policy?.collectionMode === 'PREPAY_WITH_SHORTFALL' ? await db.prepayAccount.findUnique({ where: {
    tenantId_roomId: { tenantId: responsibility.tenantId!, roomId: meter.roomId },
  } }) : null;
  const ledger = account ? await db.prepayTransaction.aggregate({ where: { accountId: account.id }, _sum: { amount: true } }) : null;
  if (policy?.collectionMode === 'PREPAY_WITH_SHORTFALL') {
    if (!account && amount > 0) return chargeBlock('MISSING_PREPAY_ACCOUNT', '该租客本房间缺少预付账户', '开户并核对余额流水后重试');
    if (account && (account.balanceCache < 0 || (ledger?._sum.amount ?? 0) !== account.balanceCache)) return chargeBlock('BALANCE_REVIEW_REQUIRED', '预付账户余额与流水不一致', '核账完成后重新预览');
  }
  const prepayApplied = account ? Math.min(account.balanceCache, amount) : 0;
  return {
    ...quote, amount, responsibility, responsibilities: intervals, policy: policy ?? null, policies: applicable,
    account, ledgerAmount: ledger?._sum.amount ?? null,
    collectionMode: policy?.collectionMode ?? null, prepayApplied,
    receivableAmount: policy?.collectionMode === 'DIRECT_TO_PROVIDER' ? 0 : amount - prepayApplied,
    providerAmount: policy?.collectionMode === 'DIRECT_TO_PROVIDER' ? amount : 0,
  };
}

