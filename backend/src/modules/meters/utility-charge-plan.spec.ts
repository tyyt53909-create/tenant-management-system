import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewMeterCharge } from './utility-charge-plan.js';
import { meterTestContract, testClock, testPriceService } from './meter-test.providers.js';

describe('confirmed utility policy and responsibility quotation', () => {
  let db: any;
  const meter = { id: 'm', roomId: 'r', meterType: 'ELECTRICITY' as const, unitPrice: 999 };
  const opening = { id: 'start', readingTime: new Date('2026-01-01T01:00Z'), currentReading: 100 };
  const target = { id: 'end', readingTime: new Date('2026-01-03T01:00Z'), currentReading: 110 };
  const responsibility = { id: 'interval', responsibility: 'TENANT', contractId: 'c', tenantId: 't', startAt: opening.readingTime, endAt: null };
  const policy = (changes: any = {}) => ({ id: 'p', effectiveFrom: opening.readingTime, rateCents: new Prisma.Decimal('61.7'), collectionMode: 'PREPAY_WITH_SHORTFALL', calculationMode: 'METER_DELTA_FLAT_RATE', roundingRule: 'HALF_UP_CHARGE_V1', ...changes });
  beforeEach(() => { db = {
    meterReading: { fields: { createdAt: Symbol('createdAt') }, findMany: vi.fn().mockResolvedValue([]) },
    meterResponsibilityInterval: { findMany: vi.fn().mockResolvedValue([responsibility]) },
    utilityPolicyVersion: { findMany: vi.fn().mockResolvedValue([policy()]) },
    utilityCharge: { findFirst: vi.fn().mockResolvedValue(null) },
    contract: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([meterTestContract('c', 't')]) },
    prepayAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'account', balanceCache: 300 }) },
    prepayTransaction: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 300 } }) },
    meterPriceHistory: { findMany: vi.fn().mockResolvedValue([]) },
  }; });
  const quote = (base = opening, end = target, selected = meter) => reviewMeterCharge(db, testClock(), testPriceService(db), selected, base, end);
  it.each(['PREPAY_WITH_SHORTFALL', 'POSTPAID', 'DIRECT_TO_PROVIDER'])('quotes exact amounts for %s using confirmed policy rather than mutable meter price', async (mode) => {
    db.utilityPolicyVersion.findMany.mockResolvedValue([policy({ collectionMode: mode })]);
    expect(await quote()).toMatchObject({ amount: 617, prepayApplied: mode === 'PREPAY_WITH_SHORTFALL' ? 300 : 0, receivableAmount: mode === 'DIRECT_TO_PROVIDER' ? 0 : mode === 'POSTPAID' ? 617 : 317, providerAmount: mode === 'DIRECT_TO_PROVIDER' ? 617 : 0 });
    expect(db.prepayAccount.findUnique).toHaveBeenCalledTimes(mode === 'PREPAY_WITH_SHORTFALL' ? 1 : 0);
  });
  it('requires true boundaries, continuous unique responsibility and matching live occupancy', async () => {
    expect(await quote(opening, { ...target, readingTime: new Date('2099-01-01') })).toMatchObject({ reasonCode: 'OWNERSHIP_UNRESOLVED' });
    expect(await quote(opening, target, { ...meter, roomId: null } as any)).toMatchObject({ reasonCode: 'OWNERSHIP_UNRESOLVED' });
    expect(await reviewMeterCharge(db, testClock(), testPriceService(db), meter, null, target)).toMatchObject({ reasonCode: 'OWNERSHIP_UNRESOLVED' });
    for (const intervals of [[], [{ ...responsibility, startAt: new Date('2026-01-02') }], [{ ...responsibility, endAt: new Date('2026-01-02') }], [responsibility, { ...responsibility, tenantId: 'other' }]]) {
      db.meterResponsibilityInterval.findMany.mockResolvedValue(intervals);
      expect(await quote()).toMatchObject({ reasonCode: 'OWNERSHIP_UNRESOLVED' });
    }
    db.meterResponsibilityInterval.findMany.mockResolvedValue([responsibility]);
    db.contract.findMany.mockResolvedValue([meterTestContract('another', 't')]);
    expect(await quote()).toMatchObject({ reasonCode: 'OWNERSHIP_UNRESOLVED' });
    db.contract.findMany.mockResolvedValue([]);
    expect(await quote()).toMatchObject({ reasonCode: 'OWNERSHIP_UNRESOLVED' });
  });
  it('allows contiguous evidence of one tenant and refuses any previously charged coverage', async () => {
    const middle = new Date('2026-01-02T01:00Z');
    db.meterResponsibilityInterval.findMany.mockResolvedValue([{ ...responsibility, endAt: middle }, { ...responsibility, startAt: middle, endAt: target.readingTime }]);
    expect(await quote()).toMatchObject({ amount: 617 });
    db.utilityCharge.findFirst.mockResolvedValue({ id: 'existing' });
    expect(await quote()).toMatchObject({ reasonCode: 'UTILITY_COVERAGE_CONFLICT' });
  });
  it('blocks unknown policies, unsupported rules and mode changes instead of inferring consent', async () => {
    db.utilityPolicyVersion.findMany.mockResolvedValue([]);
    expect(await quote()).toMatchObject({ reasonCode: 'LEGACY_REVIEW_REQUIRED' });
    for (const patch of [{ calculationMode: 'STATEMENT' }, { roundingRule: 'ROUND_EACH_SEGMENT' }, { collectionMode: 'POSTPAID', effectiveFrom: new Date('2026-01-02T01:00Z') }]) {
      db.utilityPolicyVersion.findMany.mockResolvedValue([policy(), policy(patch)]);
      expect(await quote()).toMatchObject({ reasonCode: 'POLICY_BOUNDARY_REQUIRED' });
    }
  });
  it('requires exact source readings at changed policy boundaries and sums fractional cents once', async () => {
    const at = new Date('2026-01-02T01:00Z');
    db.utilityPolicyVersion.findMany.mockResolvedValue([policy(), policy({ id: 'p2', rateCents: new Prisma.Decimal('70.000001'), effectiveFrom: at })]);
    expect(await quote()).toMatchObject({ reasonCode: 'MISSING_RATE_BOUNDARY' });
    db.meterReading.findMany.mockResolvedValue([{ id: 'boundary', readingTime: at, currentReading: 105 }]);
    expect(await quote()).toMatchObject({ amount: 659, segments: [{ policyVersionId: 'p', rateCents: '61.7' }, { policyVersionId: 'p2', rateCents: '70.000001' }] });
  });
  it('requires consistent prepay funding, allows zero-value use and preserves invalid handoff blocks', async () => {
    db.prepayAccount.findUnique.mockResolvedValue(null);
    expect(await quote()).toMatchObject({ reasonCode: 'MISSING_PREPAY_ACCOUNT' });
    db.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: 400 });
    expect(await quote()).toMatchObject({ reasonCode: 'BALANCE_REVIEW_REQUIRED' });
    db.prepayAccount.findUnique.mockResolvedValue({ id: 'a', balanceCache: -1 });
    expect(await quote()).toMatchObject({ reasonCode: 'BALANCE_REVIEW_REQUIRED' });
    db.prepayAccount.findUnique.mockResolvedValue(null);
    expect(await quote(opening, { ...target, currentReading: 100 })).toMatchObject({ amount: 0 });
    expect(await quote(opening, { ...target, currentReading: 5, handoffRequired: true } as any)).toMatchObject({ reasonCode: 'UNCONFIRMED_HANDOFF' });
    db.utilityPolicyVersion.findMany.mockResolvedValue([policy({ rateCents: new Prisma.Decimal('9999999999.999999') })]);
    expect(await quote()).toMatchObject({ reasonCode: 'AMOUNT_OUT_OF_RANGE' });
  });
  it('records only explicit owner responsibility with zero financial effects and blocks live tenant conflicts', async () => {
    db.meterResponsibilityInterval.findMany.mockResolvedValue([{ ...responsibility, responsibility: 'OWNER', contractId: null, tenantId: null }]);
    expect(await quote()).toMatchObject({ reasonCode: 'OWNERSHIP_UNRESOLVED' });
    db.contract.findMany.mockResolvedValue([]);
    expect(await quote()).toMatchObject({ amount: 0, collectionMode: null, providerAmount: 0, receivableAmount: 0, prepayApplied: 0 });
    expect(db.prepayAccount.findUnique).not.toHaveBeenCalled();
  });
});
