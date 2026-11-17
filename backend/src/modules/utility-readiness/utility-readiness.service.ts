import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { lockLeaseRoom } from '../contracts/contract-activation.js';
import { lockMeters, findMeterSettlementCursor, METER_WRITE_TRANSACTION } from '../meters/meter-settlement-state.js';
import { realMeterReadings } from '../meters/meter-reading-scope.js';
import { resolveMeterUsageOwner } from '../meters/meter-usage-attribution.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ConfirmUtilityRuleDto, ReviewUtilityRuleDto, UtilityInventoryQueryDto } from './utility-readiness.dto.js';

type Issue = { code: string; message: string };
const issue = (code: string, message: string): Issue => ({ code, message });

/** Expand phase: confirms evidence and previews rules. Financial posting remains a separate rollout. */
@Injectable()
export class UtilityReadinessService {
  constructor(private readonly prisma: PrismaService, private readonly clock: BusinessClock) {}

  async contract(contractId: string) {
    return this.prisma.$transaction(async (tx) => {
      const lease = await tx.contract.findUnique({
        where: { id: contractId },
        select: { id: true, roomId: true, contractNumber: true, tenantId: true, tenant: { select: { name: true } } },
      });
      if (!lease) throw new NotFoundException('合同不存在');
      const meters = await tx.meter.findMany({ where: { roomId: lease.roomId, isActive: true }, orderBy: { id: 'asc' } });
      const policies = await tx.utilityPolicyVersion.findMany({ where: { contractId }, orderBy: { version: 'desc' } });
      const intervals = await tx.meterResponsibilityInterval.findMany({
        where: { roomId: lease.roomId }, orderBy: { startAt: 'asc' },
      });
      const account = await tx.prepayAccount.findUnique({ where: { tenantId_roomId: { tenantId: lease.tenantId, roomId: lease.roomId } } });
      const transactions = account ? await tx.prepayTransaction.aggregate({ where: { accountId: account.id }, _sum: { amount: true } }) : null;
      const accountConsistent = !account || (transactions?._sum.amount ?? 0) === account.balanceCache;
      const rows = await Promise.all(meters.map(async (meter) => {
        const policy = policies.find((row) => row.feeType === meter.meterType) ?? null;
        const responsibilityIntervals = intervals.filter((row) => row.meterId === meter.id);
        const issues: Issue[] = [];
        if (!policy) issues.push(issue('LEGACY_REVIEW_REQUIRED', '请核对并明确确认本合同的收款模式及费率'));
        if (!responsibilityIntervals.some((row) => row.contractId === contractId)) {
          issues.push(issue('OWNERSHIP_UNRESOLVED', '尚无本合同已确认的表计责任段'));
        }
        if (policy?.collectionMode === 'PREPAY_WITH_SHORTFALL' && !account) {
          issues.push(issue('PREPAY_ACCOUNT_MISSING', '预付模式需建立该租客在本房间的账户'));
        }
        if (policy?.collectionMode === 'PREPAY_WITH_SHORTFALL' && !accountConsistent) issues.push(issue('BALANCE_REVIEW_REQUIRED', '预付余额与流水合计不一致，请核账'));
        const readings = await tx.meterReading.findMany({
          where: { meterId: meter.id, ...realMeterReadings(tx), readingTime: { lte: this.clock.now() } },
          orderBy: [{ readingTime: 'desc' }, { id: 'desc' }], take: 100,
          select: { id: true, currentReading: true, readingTime: true, handoffRequired: true },
        });
        return {
          id: meter.id, meterNumber: meter.meterNumber, meterType: meter.meterType,
          policy, responsibilityIntervals, readings, issues,
          cursor: await findMeterSettlementCursor(tx, meter.id),
        };
      }));
      return { contract: lease, meters: rows, phase: 'EVIDENCE_REVIEW', financialPostingEnabled: false };
    }, { isolationLevel: 'RepeatableRead' });
  }

  /** Bounded, read-only inventory. The response states whether more rows remain. */
  async inventory({ buildingId, afterId }: UtilityInventoryQueryDto) {
    return this.prisma.$transaction(async (tx) => {
      const leases = await tx.contract.findMany({
        where: { ...(buildingId && { buildingId }), ...(afterId && { id: { gt: afterId } }), status: { not: 'DRAFT' } },
        select: { id: true, contractNumber: true, roomId: true, utilityPolicyVersions: { select: { feeType: true } } },
        orderBy: { id: 'asc' }, take: 201,
      });
      const items = await Promise.all(leases.slice(0, 200).map(async (lease) => {
        const meters = await tx.meter.findMany({ where: { roomId: lease.roomId, isActive: true }, select: { id: true, meterType: true } });
        const unresolvedMeters = meters.filter((meter) => !lease.utilityPolicyVersions.some((p) => p.feeType === meter.meterType));
        return { contractId: lease.id, contractNumber: lease.contractNumber, roomId: lease.roomId, unresolvedMeterIds: unresolvedMeters.map((m) => m.id) };
      }));
      return { items, nextCursor: leases.length > 200 ? items.at(-1)!.contractId : null, financialPostingEnabled: false };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async preview(dto: ReviewUtilityRuleDto) {
    return this.prisma.$transaction((tx) => this.plan(tx, dto), { isolationLevel: 'RepeatableRead' });
  }

  async confirm(dto: ConfirmUtilityRuleDto, operatorId: string) {
    const payloadHash = hash(normalize(dto));
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT true FROM pg_advisory_xact_lock(hashtextextended(${dto.requestId}, 0))`;
      const previous = await tx.utilityRuleConfirmation.findUnique({ where: { requestId: dto.requestId } });
      if (previous) {
        if (previous.payloadHash !== payloadHash) throw apiError(ErrorCode.IDEMPOTENCY_CONFLICT, '相同确认编号不能提交不同资料');
        return previous.result;
      }
      const location = await tx.meter.findUnique({ where: { id: dto.meterId }, select: { roomId: true } });
      if (!location?.roomId) throw new NotFoundException('房间表计不存在');
      await lockLeaseRoom(tx, location.roomId);
      if (dto.contractId) await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${dto.contractId} FOR UPDATE`;
      await lockMeters(tx, [dto.meterId]);
      const plan = await this.plan(tx, dto);
      if (plan.meter.roomId !== location.roomId || plan.reviewToken !== dto.reviewToken) {
        throw apiError(ErrorCode.PREVIEW_STALE, '资料已变化，请重新预览并确认');
      }
      if (!plan.ready) throw apiError(ErrorCode.UTILITY_RULE_BLOCKED, plan.blockingIssues[0].message, { blockingIssues: plan.blockingIssues });

      let policy = plan.policy;
      if (dto.responsibility === 'TENANT' && !policy) {
        policy = await tx.utilityPolicyVersion.create({ data: {
          contractId: dto.contractId!, feeType: plan.meter.meterType, version: plan.nextPolicyVersion,
          collectionMode: dto.collectionMode!, rateCents: dto.rateCents!, unit: plan.unit,
          effectiveFrom: plan.opening!.readingTime, confirmedBy: operatorId, confirmedAt: this.clock.now(), evidence: dto.evidence.trim(),
        } });
      }
      const interval = await tx.meterResponsibilityInterval.create({ data: {
        meterId: dto.meterId, roomId: plan.meter.roomId!,
        contractId: dto.contractId ?? null, tenantId: plan.contract?.tenantId ?? null,
        responsibility: dto.responsibility, startAt: plan.opening!.readingTime, endAt: plan.closing!.readingTime,
        openingReadingId: dto.openingReadingId, closingReadingId: dto.closingReadingId,
        confirmedBy: operatorId, confirmedAt: this.clock.now(), evidence: dto.evidence.trim(),
      } });
      const result = {
        responsibilityIntervalId: interval.id, policyVersionId: policy?.id ?? null,
        policyVersion: policy?.version ?? null, financialEffect: 'NONE',
      };
      await tx.auditLog.create({ data: {
        userId: operatorId, action: 'CONFIRM_UTILITY_RULE', entityType: 'MeterResponsibilityInterval', entityId: interval.id,
        changes: { before: null, after: { ...result, meterId: dto.meterId, contractId: dto.contractId ?? null, responsibility: dto.responsibility } },
        ip: 'unknown', userAgent: 'unknown',
      } });
      await tx.utilityRuleConfirmation.create({ data: { requestId: dto.requestId, payloadHash, result, confirmedBy: operatorId, confirmedAt: this.clock.now() } });
      return result;
    }, METER_WRITE_TRANSACTION);
  }

  private async plan(tx: Prisma.TransactionClient, dto: ReviewUtilityRuleDto) {
    const meter = await tx.meter.findUnique({ where: { id: dto.meterId } });
    if (!meter?.roomId) throw new NotFoundException('房间表计不存在');
    const blockingIssues: Issue[] = [];
    const billingIssues: Issue[] = [];
    if (!meter.isActive) blockingIssues.push(issue('METER_UNAVAILABLE', '表计已停用'));
    const readings = await tx.meterReading.findMany({
      where: { meterId: dto.meterId, ...realMeterReadings(tx), id: { in: [dto.openingReadingId, dto.closingReadingId] } },
    });
    const opening = readings.find((r) => r.id === dto.openingReadingId) ?? null;
    const closing = readings.find((r) => r.id === dto.closingReadingId) ?? null;
    const validBoundaries = opening && closing && opening.readingTime < closing.readingTime && closing.readingTime <= this.clock.now();
    if (!validBoundaries) blockingIssues.push(issue('MISSING_BASELINE', '请选择同一表计上按时间先后排列的两笔真实读数，时间不得在未来'));

    const contract = dto.contractId ? await tx.contract.findUnique({ where: { id: dto.contractId } }) : null;
    const ownershipEvidence = await tx.contract.findMany({
      where: { roomId: meter.roomId }, orderBy: { id: 'asc' },
      select: {
        id: true, tenantId: true, status: true, startDate: true, endDate: true, renewedFromId: true,
        moveIn: { select: { occupiedAt: true } },
        inspections: {
          where: { status: 'CONFIRMED' }, orderBy: { id: 'asc' },
          select: { id: true, type: true, inspectedAt: true, tenantConfirmedAt: true, tenantId: true, roomId: true },
        },
        checkoutRecords: { where: { status: 'COMPLETED' }, orderBy: { id: 'asc' }, select: { id: true, roomId: true, checkoutDate: true } },
      },
    });
    const policies = contract ? await tx.utilityPolicyVersion.findMany({
      where: { contractId: contract.id, feeType: meter.meterType }, orderBy: { version: 'desc' },
    }) : [];
    const latestPolicy = policies[0] ?? null;
    const requestedRate = new Prisma.Decimal(dto.rateCents ?? '0');
    const applicablePolicy = opening ? policies.find((row) => row.effectiveFrom <= opening.readingTime) : null;
    const policy = applicablePolicy && applicablePolicy.collectionMode === dto.collectionMode && applicablePolicy.rateCents.eq(requestedRate)
      ? applicablePolicy : null;

    if (dto.responsibility === 'TENANT') {
      if (!contract || contract.roomId !== meter.roomId || contract.buildingId !== meter.buildingId) {
        blockingIssues.push(issue('OWNERSHIP_UNRESOLVED', '合同、房间和表计不一致'));
      } else if (contract.status === 'DRAFT' || (validBoundaries
        && (this.clock.todayUtc(opening.readingTime) < contract.startDate || this.clock.todayUtc(closing.readingTime) > contract.endDate))) {
        blockingIssues.push(issue('LEASE_INTERVAL_INVALID', '责任段须在已生效的合同租期内'));
      }
      if (validBoundaries && contract?.roomId === meter.roomId) {
        const owner = await resolveMeterUsageOwner(tx, this.clock, meter.roomId, opening.readingTime, closing.readingTime);
        if (owner.kind !== 'TENANT' || owner.contractId !== contract.id || owner.tenantId !== contract.tenantId) {
          blockingIssues.push(issue('OWNERSHIP_UNRESOLVED', '交接事实尚不能将整段用量归属本合同，请先核验入住及退租记录'));
        }
      }
      if (latestPolicy && !policy && opening && latestPolicy.effectiveFrom >= opening.readingTime) {
        blockingIssues.push(issue('POLICY_VERSION_CONFLICT', '新规则生效点须晚于已确认版本，历史版本保留'));
      }
      if (validBoundaries && policies.some((row) => row.effectiveFrom > opening.readingTime && row.effectiveFrom < closing.readingTime)) {
        blockingIssues.push(issue('RATE_BOUNDARY_REQUIRED', '该段跨越已确认的规则版本，请在生效读数处分段核验'));
      }
    } else {
      if (dto.contractId || dto.collectionMode || dto.rateCents !== undefined) {
        blockingIssues.push(issue('OWNER_RULE_CONFLICT', '空置责任段只登记房东责任及交接证据'));
      }
      if (validBoundaries) {
        const overlapLease = await tx.contract.findFirst({ where: {
          roomId: meter.roomId, status: { not: 'DRAFT' },
          startDate: { lte: this.clock.todayUtc(closing.readingTime) }, endDate: { gte: this.clock.todayUtc(opening.readingTime) },
        }, select: { id: true } });
        const owner = await resolveMeterUsageOwner(tx, this.clock, meter.roomId, opening.readingTime, closing.readingTime);
        if (overlapLease && owner.kind !== 'VACANT') blockingIssues.push(issue('OWNERSHIP_UNRESOLVED', '该段与租约日期重叠，请先核验实际交接事实'));
      }
    }

    const overlaps = validBoundaries ? await tx.meterResponsibilityInterval.findMany({ where: {
      meterId: meter.id, startAt: { lt: closing.readingTime }, endAt: { gt: opening.readingTime },
    }, select: { id: true } }) : [];
    if (overlaps.length) blockingIssues.push(issue('RESPONSIBILITY_OVERLAP', '该用量范围已有确认责任段，请查看原纪录'));
    const intervalReadings = validBoundaries ? await tx.meterReading.findMany({
      where: { meterId: meter.id, ...realMeterReadings(tx), readingTime: { gte: opening.readingTime, lte: closing.readingTime } },
      orderBy: [{ readingTime: 'asc' }, { id: 'asc' }], take: 2001,
    }) : [];
    if (intervalReadings.length > 2000) blockingIssues.push(issue('INTERVAL_TOO_LARGE', '该段读数过多，请分段核验'));
    if (intervalReadings.some((row, index) => row.handoffRequired || row.handoffPreviousFinal != null
      || (index > 0 && row.currentReading.lt(intervalReadings[index - 1].currentReading)))) {
      blockingIssues.push(issue('HANDOFF_REVIEW_REQUIRED', '该段含回退或换表，请按已确认的物理表段分别核验'));
    }
    const usage = validBoundaries ? closing.currentReading.minus(opening.currentReading) : new Prisma.Decimal(0);
    const rawAmount = usage.mul(requestedRate).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    if (rawAmount.lt(0) || rawAmount.gt(2147483647)) blockingIssues.push(issue('AMOUNT_OUT_OF_RANGE', '计费金额超出支持范围'));

    const account = contract ? await tx.prepayAccount.findUnique({ where: { tenantId_roomId: { tenantId: contract.tenantId, roomId: meter.roomId } } }) : null;
    const ledger = account ? await tx.prepayTransaction.aggregate({ where: { accountId: account.id }, _sum: { amount: true } }) : null;
    const accountConsistent = account && account.balanceCache >= 0 && (ledger?._sum.amount ?? 0) === account.balanceCache;
    if (dto.collectionMode === 'PREPAY_WITH_SHORTFALL') {
      if (!account) billingIssues.push(issue('PREPAY_ACCOUNT_MISSING', '预付模式正式计费前需建立本租客本房间账户'));
      else if (!accountConsistent) billingIssues.push(issue('BALANCE_REVIEW_REQUIRED', '预付余额与流水不一致，请核账'));
    }
    const amountsKnown = blockingIssues.length === 0;
    const totalAmount = dto.responsibility === 'TENANT' ? rawAmount.toNumber() : 0;
    const prepayApplied = dto.collectionMode === 'PREPAY_WITH_SHORTFALL' ? Math.min(Math.max(0, account?.balanceCache ?? 0), totalAmount) : 0;
    const financialPreview = {
      usage: amountsKnown ? usage.toString() : null, rateCents: dto.responsibility === 'TENANT' ? requestedRate.toString() : null,
      totalAmount: amountsKnown ? totalAmount : null,
      prepayApplied: !amountsKnown || billingIssues.length ? null : prepayApplied,
      receivableAmount: !amountsKnown || billingIssues.length ? null : dto.collectionMode === 'DIRECT_TO_PROVIDER' ? 0 : totalAmount - prepayApplied,
      providerAmount: amountsKnown ? dto.collectionMode === 'DIRECT_TO_PROVIDER' ? totalAmount : 0 : null,
      financialEffect: 'NONE',
    };
    const snapshot = { request: normalize(dto), meter, opening, closing, contract, ownershipEvidence, policies, overlaps, intervalReadings, account, ledger };
    return {
      ready: blockingIssues.length === 0, blockingIssues, billingIssues, reviewToken: hash(snapshot),
      financialPreview, financialPostingEnabled: false, phase: 'EVIDENCE_REVIEW',
      meter, contract, opening, closing, policy, nextPolicyVersion: (latestPolicy?.version ?? 0) + 1,
      unit: meter.meterType === 'ELECTRICITY' ? 'kWh' : 'm³',
    };
  }
}

function normalize(dto: ReviewUtilityRuleDto) {
  return {
    meterId: dto.meterId, contractId: dto.contractId ?? null, responsibility: dto.responsibility,
    openingReadingId: dto.openingReadingId, closingReadingId: dto.closingReadingId,
    collectionMode: dto.collectionMode ?? null, rateCents: dto.rateCents === undefined ? null : new Prisma.Decimal(dto.rateCents).toString(),
    evidence: dto.evidence.trim(),
  };
}

function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
