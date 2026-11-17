import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { MeterBillingService } from '../meters/meter-billing.service.js';
import { quoteScheduledRent } from '../scheduler/scheduled-rent.js';

export type ChargeReview = {
  state: 'READY' | 'BLOCKED' | 'NO_CHANGE';
  amount: number;
  reasonCode: string;
  reason: string;
  retryCondition?: string;
  fingerprint?: string;
  contractId?: string;
};

const noChange = (reasonCode: string, reason: string): ChargeReview => ({ state: 'NO_CHANGE', reasonCode, reason, amount: 0 });

export const blocked = (reasonCode: string, reason: string, retryCondition: string): ChargeReview =>
  ({ state: 'BLOCKED', reasonCode, reason, retryCondition, amount: 0 });

export async function reviewUtility(
  tx: Prisma.TransactionClient, billing: MeterBillingService, clock: BusinessClock,
  meterId: string, buildingId: string, cutoff: Date,
): Promise<ChargeReview> {
  const meter = await tx.meter.findFirst({ where: { id: meterId, buildingId, isActive: true, roomId: { not: null } }, select: { id: true } });
  if (!meter) return blocked('METER_UNAVAILABLE', '表计已停用或不属于本楼栋', '核对表计启用状态及房间绑定');
  const info = await billing.getUnsettledUsage(meterId, cutoff.toISOString(), tx);
  if (!info.hasReadings || !info.readingTime || clock.monthKey(info.readingTime) !== clock.monthKey(cutoff)) {
    return blocked('NO_READINGS', '本账期截止时点前缺少有效读数', '补录本账期内且不晚于截止时点的真实读数');
  }
  if (info.alreadySettled) return noChange('ALREADY_SETTLED', '截止时点内用量已处理');
  if ('settlementBlock' in info && info.settlementBlock) {
    const reason = info.settlementBlock;
    return blocked(reason.reasonCode, reason.reason, reason.retryCondition);
  }
  if (info.attribution?.reasonCode === 'OCCUPANCY_UNCERTAIN') {
    const reason = info.attribution;
    return blocked(reason.reasonCode, reason.reason, reason.retryCondition);
  }
  if (info.contractId && info.estimatedAmount > 0 && info.prepayBalance == null) {
    return blocked('MISSING_PREPAY_ACCOUNT', '租客缺预付账户', '开户并核对归属后重新预览');
  }
  const fingerprint = seal([
    info.targetReadingId, info.baselineReadingId, info.contractId, info.currentReading, info.unsettledUsage,
    info.estimatedAmount, 'segments' in info ? info.segments : null,
  ]);
  return {
    state: 'READY', amount: info.estimatedAmount, reasonCode: 'READY', reason: '待确认结算',
    fingerprint, ...(info.contractId && { contractId: info.contractId }),
  };
}

export async function reviewRent(
  tx: Prisma.TransactionClient, clock: BusinessClock, contractId: string, buildingId: string, cutoff: Date,
) {
  const lease = await tx.contract.findFirst({ where: { id: contractId, buildingId }, include: { tenant: { select: { userId: true } } } });
  const day = clock.todayUtc(cutoff);
  if (!lease || lease.status !== 'ACTIVE' || lease.startDate > day || lease.endDate < clock.startOfMonth(day)) {
    return { review: blocked('LEASE_NOT_ACTIVE', '该合同在截止日不可出账', '核对合同生效状态及租期') };
  }
  const { year, month } = clock.parts(cutoff);
  const quote = quoteScheduledRent(lease, year, month);
  if (!quote || quote.amount <= 0) return { review: noChange('NO_RENT_DUE', '本月不是该合同的出账锚点或应收为零') };
  const existing = await tx.bill.findFirst({
    where: { contractId, billType: 'RENT', period: quote.period }, select: { id: true },
  });
  if (existing) return { review: noChange('ALREADY_BILLED', '本账期已有租金凭证'), billId: existing.id };
  const review: ChargeReview = {
    state: 'READY', amount: quote.amount, reasonCode: 'READY', reason: '待确认出账', contractId,
    fingerprint: seal([lease.tenantId, quote]),
  };
  return { review, quote, userId: lease.tenant.userId };
}

function seal(values: unknown[]) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
