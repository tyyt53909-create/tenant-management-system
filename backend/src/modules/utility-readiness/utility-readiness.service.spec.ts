import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { testClock } from '../meters/meter-test.providers.js';
import { UtilityReadinessService } from './utility-readiness.service.js';
import { UtilityReadinessController } from './utility-readiness.controller.js';
import { ReviewUtilityRuleDto } from './utility-readiness.dto.js';

describe('UtilityReadinessService rule decisions', () => {
  let db: any;
  let service: UtilityReadinessService;
  let dto: Pick<ReviewUtilityRuleDto, keyof ReviewUtilityRuleDto>;
  let meter: any;
  let lease: any;
  let readings: any[];
  const start = new Date('2026-04-10T00:00:00Z');
  const end = new Date('2026-04-10T02:00:00Z');

  beforeEach(() => {
    meter = { id: 'm', roomId: 'r', buildingId: 'b', meterType: 'WATER', meterNumber: 'W-1', isActive: true, unitPrice: 100 };
    lease = {
      id: 'c', roomId: 'r', buildingId: 'b', tenantId: 't', contractNumber: 'C-1', status: 'ACTIVE',
      startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
      tenant: { name: 'Tenant' }, room: { status: 'OCCUPIED' }, moveIn: null,
      inspections: [], checkoutRecords: [], utilityPolicyVersions: [],
    };
    readings = [
      { id: 'a', readingTime: start, currentReading: new Prisma.Decimal(100) },
      { id: 'z', readingTime: end, currentReading: new Prisma.Decimal(110) },
    ];
    dto = { meterId: 'm', contractId: 'c', responsibility: 'TENANT', openingReadingId: 'a', closingReadingId: 'z', collectionMode: 'POSTPAID', rateCents: '61.7', evidence: 'Verified handover and lease' };
    db = {
      meter: { findUnique: vi.fn(async () => meter), findMany: vi.fn(async () => [meter]) },
      contract: { findUnique: vi.fn(async () => lease), findMany: vi.fn(async () => [lease]), findFirst: vi.fn(async () => null) },
      meterReading: { fields: { createdAt: 'createdAt' }, findMany: vi.fn(async () => readings), findFirst: vi.fn(async () => null) },
      utilityPolicyVersion: { findMany: vi.fn(async () => []), create: vi.fn(async ({ data }) => ({ ...data, id: 'policy' })) },
      meterResponsibilityInterval: { findMany: vi.fn(async () => []), create: vi.fn(async ({ data }) => ({ ...data, id: 'interval' })) },
      prepayAccount: { findUnique: vi.fn(async () => null) },
      prepayTransaction: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
      utilityRuleConfirmation: { findUnique: vi.fn(async () => null), create: vi.fn(async ({ data }) => data) },
      auditLog: { create: vi.fn(async () => ({})) },
      $queryRaw: vi.fn(async () => []), $transaction: vi.fn(),
    };
    db.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(db));
    const clock = testClock();
    vi.spyOn(clock, 'now').mockReturnValue(new Date('2026-04-11T00:00:00Z'));
    service = new UtilityReadinessService(db, clock);
  });

  async function command() {
    const review = await service.preview(dto);
    return { ...dto, requestId: randomUUID(), reviewToken: review.reviewToken };
  }

  it.each(['PREPAY_WITH_SHORTFALL', 'POSTPAID', 'DIRECT_TO_PROVIDER'] as const)('calculates %s using decimal cents and confirms only evidence', async (mode) => {
    dto.collectionMode = mode;
    db.prepayAccount.findUnique.mockResolvedValue({ id: 'account', balanceCache: 100 });
    db.prepayTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
    const review = await service.preview(dto);
    expect(review.ready).toBe(true);
    expect(review.financialPreview).toMatchObject({ totalAmount: 617, financialEffect: 'NONE', prepayApplied: mode === 'PREPAY_WITH_SHORTFALL' ? 100 : 0 });
    const result = await service.confirm({ ...dto, requestId: randomUUID(), reviewToken: review.reviewToken }, 'admin');
    expect(result).toMatchObject({ policyVersionId: 'policy', responsibilityIntervalId: 'interval', financialEffect: 'NONE' });
    expect(db.utilityPolicyVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ collectionMode: mode, version: 1, rateCents: '61.7', unit: 'm³' }) });
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'admin', action: 'CONFIRM_UTILITY_RULE' }) });
  });

  it('reuses an applicable immutable version and returns original results on canonical request replay', async () => {
    const policy = { id: 'old-policy', version: 3, collectionMode: 'POSTPAID', rateCents: new Prisma.Decimal('61.7'), effectiveFrom: start };
    db.utilityPolicyVersion.findMany.mockResolvedValue([policy]);
    const input = await command();
    const result = await service.confirm(input, 'admin');
    expect(result).toMatchObject({ policyVersionId: policy.id, policyVersion: 3 });
    expect(db.utilityPolicyVersion.create).not.toHaveBeenCalled();
    db.utilityRuleConfirmation.findUnique.mockResolvedValue(db.utilityRuleConfirmation.create.mock.calls[0][0].data);
    expect(await service.confirm({ ...input, rateCents: '61.700000', evidence: ` ${input.evidence} ` }, 'admin')).toEqual(result);
    await expect(service.confirm({ ...input, rateCents: '62' }, 'admin')).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('rejects changed sources, unavailable rooms and blocking decisions before writes', async () => {
    const input = await command();
    meter.unitPrice = 200;
    await expect(service.confirm(input, 'admin')).rejects.toMatchObject({ response: { code: 'PREVIEW_STALE' } });
    meter.isActive = false;
    await expect(service.confirm(await command(), 'admin')).rejects.toMatchObject({ response: { code: 'UTILITY_RULE_BLOCKED' } });
    expect(db.utilityPolicyVersion.create).not.toHaveBeenCalled();
    db.meter.findUnique.mockResolvedValue(null);
    await expect(service.preview(dto)).rejects.toMatchObject({ status: 404 });
    await expect(service.confirm(input, 'admin')).rejects.toMatchObject({ status: 404 });
  });

  it('propagates persistence failure for transaction rollback', async () => {
    db.utilityRuleConfirmation.create.mockRejectedValue(new Error('confirmation unavailable'));
    await expect(service.confirm(await command(), 'admin')).rejects.toThrow('confirmation unavailable');
  });

  it('reports missing and inconsistent accounts only for prepay', async () => {
    dto.collectionMode = 'PREPAY_WITH_SHORTFALL';
    expect((await service.preview(dto)).billingIssues.map((row) => row.code)).toEqual(['PREPAY_ACCOUNT_MISSING']);
    db.prepayAccount.findUnique.mockResolvedValue({ id: 'account', balanceCache: 100 });
    expect((await service.preview(dto)).billingIssues.map((row) => row.code)).toEqual(['BALANCE_REVIEW_REQUIRED']);
    dto.collectionMode = 'POSTPAID';
    expect((await service.preview(dto)).billingIssues).toEqual([]);
  });

  it.each([
    ['METER_UNAVAILABLE', () => { meter.isActive = false; }],
    ['OWNERSHIP_UNRESOLVED', () => { lease.roomId = 'other'; }],
    ['LEASE_INTERVAL_INVALID', () => { lease.status = 'DRAFT'; }],
    ['LEASE_INTERVAL_INVALID', () => { lease.startDate = new Date('2026-04-11'); }],
    ['MISSING_BASELINE', () => { readings.pop(); }],
    ['MISSING_BASELINE', () => { readings[1].readingTime = new Date('2026-04-12'); }],
    ['HANDOFF_REVIEW_REQUIRED', () => { readings[1].handoffRequired = true; }],
    ['HANDOFF_REVIEW_REQUIRED', () => { readings[1].handoffPreviousFinal = new Prisma.Decimal(110); }],
    ['AMOUNT_OUT_OF_RANGE', () => { dto.rateCents = '9999999999'; }],
    ['HANDOFF_REVIEW_REQUIRED', () => { readings[1].currentReading = new Prisma.Decimal(90); }],
  ] as const)('blocks %s and represents unknown amounts explicitly', async (code, arrange) => {
    arrange();
    const result = await service.preview(dto);
    expect(result.ready).toBe(false);
    expect(result.blockingIssues.map((row) => row.code)).toContain(code);
    expect(result.financialPreview.totalAmount).toBeNull();
  });

  it('requires handover evidence, prevents coverage overlap and splits confirmed policy boundaries', async () => {
    lease.inspections = [{ type: 'CHECK_OUT', inspectedAt: start, tenantConfirmedAt: start, tenantId: 't', roomId: 'r' }];
    expect((await service.preview(dto)).blockingIssues.map((row) => row.code)).toContain('OWNERSHIP_UNRESOLVED');
    lease.inspections = [];
    db.meterResponsibilityInterval.findMany.mockResolvedValue([{ id: 'existing' }]);
    expect((await service.preview(dto)).blockingIssues.map((row) => row.code)).toContain('RESPONSIBILITY_OVERLAP');
    db.meterResponsibilityInterval.findMany.mockResolvedValue([]);
    db.utilityPolicyVersion.findMany.mockResolvedValue([{ id: 'future', version: 2, collectionMode: 'PREPAY_WITH_SHORTFALL', rateCents: new Prisma.Decimal(100), effectiveFrom: new Date('2026-04-10T01:00:00Z') }]);
    const result = await service.preview(dto);
    expect(result.blockingIssues.map((row) => row.code)).toEqual(expect.arrayContaining(['POLICY_VERSION_CONFLICT', 'RATE_BOUNDARY_REQUIRED']));
    db.meterReading.findMany.mockResolvedValueOnce(readings).mockResolvedValueOnce(Array.from({ length: 2001 }, () => readings[0]));
    expect((await service.preview(dto)).blockingIssues.map((row) => row.code)).toContain('INTERVAL_TOO_LARGE');
  });

  it('records explicit owner responsibility without creating a policy and rejects conflicting tenant declarations', async () => {
    dto = { meterId: 'm', responsibility: 'OWNER', openingReadingId: 'a', closingReadingId: 'z', evidence: 'Owner vacancy handover' };
    db.contract.findMany.mockResolvedValue([]);
    const result = await service.confirm(await command(), 'admin');
    expect(result).toMatchObject({ policyVersionId: null, policyVersion: null });
    expect(db.meterResponsibilityInterval.create).toHaveBeenCalledWith({ data: expect.objectContaining({ responsibility: 'OWNER', tenantId: null, contractId: null }) });
    expect(db.utilityPolicyVersion.create).not.toHaveBeenCalled();
    db.contract.findFirst.mockResolvedValue(lease);
    db.contract.findMany.mockResolvedValue([lease]);
    expect((await service.preview(dto)).blockingIssues.map((row) => row.code)).toContain('OWNERSHIP_UNRESOLVED');
    dto.rateCents = '1';
    expect((await service.preview(dto)).blockingIssues.map((row) => row.code)).toContain('OWNER_RULE_CONFLICT');
  });

  it('inventories bounded pages and reports lease rules, responsibility, cursor and account issues read-only', async () => {
    const first = await service.contract('c');
    expect(first.meters[0].issues.map((row) => row.code)).toEqual(['LEGACY_REVIEW_REQUIRED', 'OWNERSHIP_UNRESOLVED']);
    const policy = { id: 'p', feeType: 'WATER', collectionMode: 'PREPAY_WITH_SHORTFALL', rateCents: new Prisma.Decimal(100), version: 1, effectiveFrom: start };
    db.utilityPolicyVersion.findMany.mockResolvedValue([policy]);
    expect((await service.contract('c')).meters[0].issues.map((row) => row.code)).toContain('PREPAY_ACCOUNT_MISSING');
    db.prepayAccount.findUnique.mockResolvedValue({ id: 'account', balanceCache: 100 });
    db.meterResponsibilityInterval.findMany.mockResolvedValue([{ id: 'i', meterId: 'm', contractId: 'c' }]);
    expect((await service.contract('c')).meters[0].issues.map((row) => row.code)).toEqual(['BALANCE_REVIEW_REQUIRED']);
    expect((await service.inventory({})).items[0].unresolvedMeterIds).toEqual(['m']);
    lease.utilityPolicyVersions = [{ feeType: 'WATER' }];
    expect((await service.inventory({ buildingId: 'b', afterId: 'a' })).items[0].unresolvedMeterIds).toEqual([]);
    db.contract.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ ...lease, id: `c${index}` })));
    const page = await service.inventory({});
    expect(page.items).toHaveLength(200);
    expect(page.nextCursor).toBe('c199');
    db.contract.findUnique.mockResolvedValue(null);
    await expect(service.contract('missing')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects missing tenant fields and excessive precision at the DTO boundary', async () => {
    expect(await validate(plainToInstance(ReviewUtilityRuleDto, dto))).toEqual([]);
    expect(await validate(plainToInstance(ReviewUtilityRuleDto, { ...dto, collectionMode: undefined, rateCents: '0.1234567' }))).toHaveLength(2);
    expect(await validate(plainToInstance(ReviewUtilityRuleDto, { ...dto, responsibility: 'OWNER', contractId: undefined, collectionMode: undefined, rateCents: undefined }))).toEqual([]);
  });

  it('delegates controller actions with the authenticated operator and requested context', async () => {
    const controller = new UtilityReadinessController(service);
    const preview = vi.spyOn(service, 'preview').mockResolvedValue({ ready: true } as never);
    const confirm = vi.spyOn(service, 'confirm').mockResolvedValue({ financialEffect: 'NONE' });
    const contract = vi.spyOn(service, 'contract').mockResolvedValue({} as never);
    const inventory = vi.spyOn(service, 'inventory').mockResolvedValue({} as never);
    const input = { ...dto, requestId: randomUUID(), reviewToken: 'f'.repeat(64) };
    await controller.preview(dto);
    await controller.confirm(input, { userId: 'admin', role: 'ADMIN' });
    await controller.contract('c');
    await controller.inventory({ buildingId: 'b' });
    expect(preview).toHaveBeenCalledWith(dto);
    expect(confirm).toHaveBeenCalledWith(input, 'admin');
    expect(contract).toHaveBeenCalledWith('c');
    expect(inventory).toHaveBeenCalledWith({ buildingId: 'b' });
  });
});
