import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeterBillingService } from './meter-billing.service.js';
import { meterTestContract, testClock, testPriceService } from './meter-test.providers.js';
import { chargeBlock } from './utility-charge-plan.js';

describe('MeterBillingService unified posting', () => {
  let db: any;
  let service: MeterBillingService;
  let quote: any;
  const start = new Date('2026-01-14T12:00:00Z');
  const end = new Date('2026-01-15T12:00:00Z');
  const meter = { id: 'meter', roomId: 'room', meterType: 'ELECTRICITY', meterNumber: 'E-1', unitPrice: 9999 };
  const opening = { id: 'base', readingTime: start, currentReading: 100, notes: '[INITIAL]', settledAt: start };
  const target = { id: 'target', readingTime: end, currentReading: 110, notes: null };
  const block = chargeBlock('LEGACY_REVIEW_REQUIRED', 'review rules', 'confirm policy');
  const plan = (changes: any = {}) => ({ usage: 10, amount: 617, unitPrice: 61.7, segments: [{ startReadingId: 'base', endReadingId: 'target', startAt: start.toISOString(), endAt: end.toISOString(), startReading: 100, endReading: 110, usage: 10, unitPrice: 61.7, rateCents: '61.7', policyVersionId: 'policy' }],
    responsibility: { id: 'interval', responsibility: 'TENANT', contractId: 'contract', tenantId: 'tenant', evidence: 'confirmed' },
    responsibilities: [{ id: 'interval', startAt: start, endAt: null, evidence: 'confirmed' }],
    policy: { id: 'policy' }, policies: [{ id: 'policy', version: 1, rateCents: '61.7', effectiveFrom: start, evidence: 'confirmed' }],
    account: { id: 'account', balanceCache: 300 }, collectionMode: 'PREPAY_WITH_SHORTFALL', prepayApplied: 300, receivableAmount: 317, providerAmount: 0, ...changes });
  beforeEach(() => {
    db = {
      meter: { findUnique: vi.fn().mockResolvedValue(meter), findUniqueOrThrow: vi.fn().mockResolvedValue(meter), findMany: vi.fn().mockResolvedValue([{ id: 'meter' }]) },
      meterReading: { fields: { createdAt: Symbol('createdAt') }, findFirst: vi.fn(async ({ where }: any) => where.id === 'base' ? opening : where.id === 'target' ? target : where.OR ? opening : target), update: vi.fn() },
      utilityCharge: { create: vi.fn().mockResolvedValue({ id: 'charge' }), findUnique: vi.fn() },
      utilityPostingConfirmation: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      prepayAccount: { findUnique: vi.fn().mockResolvedValue({ balanceCache: 300 }), update: vi.fn().mockResolvedValue({ balanceCache: 0 }) },
      prepayTransaction: { create: vi.fn().mockResolvedValue({ id: 'transaction' }) },
      bill: { create: vi.fn().mockResolvedValue({ id: 'bill' }) },
      contract: { findMany: vi.fn().mockResolvedValue([meterTestContract('contract', 'tenant')]) },
      $queryRaw: vi.fn().mockResolvedValue([]), $transaction: vi.fn((fn) => fn(db)),
    };
    service = new MeterBillingService(db, testClock(), testPriceService(db));
    quote = vi.spyOn(service, 'quoteInterval').mockResolvedValue(plan());
  });
  const apply = () => service.applyReadingDeduction(db, meter, target, 10, 'operator', opening);

  it('locks and rechecks the account before debit, saves full provenance, and only bills the shortfall', async () => {
    expect(await apply()).toMatchObject({ applied: true, amount: 617, deducted: 300, shortfall: 317, chargeId: 'charge' });
    expect(quote).toHaveBeenCalledTimes(2);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.prepayAccount.update).toHaveBeenCalledWith({ where: { id: 'account' }, data: { balanceCache: { decrement: 300 } } });
    expect(db.prepayTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: -300, balanceAfter: 0, relatedId: target.id }) });
    expect(db.bill.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 317, dedupKey: 'UTILITY:METER:meter:base:target', snapshot: expect.objectContaining({ unitPrice: null, totalAmount: 617, shortfall: 317 }) }) });
    expect(db.utilityCharge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ totalAmount: 617, prepayApplied: 300, receivableAmount: 317, providerAmount: 0, policyVersionId: 'policy', responsibilityIntervalId: 'interval', notificationState: 'PENDING' }) });
  });
  it.each([
    ['PREPAY_WITH_SHORTFALL', 617, 0, 0], ['POSTPAID', 0, 617, 0], ['DIRECT_TO_PROVIDER', 0, 0, 617],
  ])('posts %s with exactly the intended debit, bill and external amount', async (mode, deducted, receivable, external) => {
    quote.mockResolvedValue(plan({ collectionMode: mode, prepayApplied: deducted, receivableAmount: receivable, providerAmount: external, account: mode === 'PREPAY_WITH_SHORTFALL' ? { id: 'account' } : null }));
    expect(await apply()).toMatchObject({ applied: true, deducted, shortfall: receivable, providerAmount: external });
    expect(db.prepayTransaction.create).toHaveBeenCalledTimes(deducted ? 1 : 0);
    expect(db.bill.create).toHaveBeenCalledTimes(receivable ? 1 : 0);
    expect(db.prepayAccount.update).toHaveBeenCalledTimes(deducted ? 1 : 0);
  });
  it('blocks invalid source, unknown rules and account inconsistencies discovered after acquiring its lock', async () => {
    await expect(service.applyReadingDeduction(db, meter, { ...target, source: 'SIMULATED' }, 10, 'op', opening)).rejects.toMatchObject({ response: { code: 'UTILITY_RULE_BLOCKED' } });
    quote.mockResolvedValueOnce(block);
    expect(await apply()).toMatchObject({ applied: false, reasonCode: 'LEGACY_REVIEW_REQUIRED' });
    quote.mockResolvedValueOnce(plan()).mockResolvedValueOnce(block);
    expect(await apply()).toMatchObject({ applied: false });
    expect(db.prepayAccount.update).not.toHaveBeenCalled();
    expect(db.utilityCharge.create).not.toHaveBeenCalled();
  });
  it('records zero-value owner use without a bill, debit or notification intent and supports unknown type labels', async () => {
    quote.mockResolvedValue(plan({ amount: 0, account: null, policy: null, policies: [], collectionMode: null, prepayApplied: 0, receivableAmount: 0, responsibility: { id: 'interval', responsibility: 'OWNER', contractId: null, tenantId: null } }));
    expect(await service.applyReadingDeduction(db, { ...meter, meterType: 'UNKNOWN' }, target, 10, 'op', opening)).toMatchObject({ reasonCode: 'VACANT_INTERVAL' });
    expect(db.utilityCharge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ contractId: null, notificationState: 'NOT_REQUIRED' }) });
    quote.mockResolvedValue(plan({ unitPrice: 10, segments: [] }));
    await service.applyReadingDeduction(db, { ...meter, meterType: 'UNKNOWN' }, target, 10, 'op', opening);
    expect(db.prepayTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ description: expect.stringContaining('水电费') }) });
  });
  it('reads formal charges and rejects unknown IDs', async () => {
    await expect(service.charge('missing')).rejects.toBeInstanceOf(NotFoundException);
    db.utilityCharge.findUnique.mockResolvedValue({ id: 'charge' });
    expect(await service.charge('charge')).toEqual({ id: 'charge' });
  });
  it('keeps previews read-only and reports mode, amounts, source and a deterministic review token', async () => {
    const first = await service.getUnsettledUsage('meter');
    const second = await service.getUnsettledUsage('meter');
    expect(first).toMatchObject({ estimatedAmount: 617, prepayApplied: 300, receivableAmount: 317, providerAmount: 0, targetReadingId: 'target', baselineReadingId: 'base', tenantName: '租客' });
    expect(first).toEqual(second);
    expect(db.prepayAccount.update).not.toHaveBeenCalled();
    quote.mockResolvedValue(block);
    expect(await service.getUnsettledUsage('meter')).toMatchObject({ settlementBlock: block, estimatedAmount: 0 });
  });
  it('handles absent meter/readings, already settled sources and global cursor ahead of a historical cutoff', async () => {
    db.meter.findUnique.mockResolvedValueOnce(null);
    await expect(service.getUnsettledUsage('missing')).rejects.toBeInstanceOf(NotFoundException);
    db.meterReading.findFirst.mockResolvedValueOnce(null);
    expect(await service.getUnsettledUsage('meter')).toMatchObject({ hasReadings: false });
    db.meterReading.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce({ ...target, settledAt: end });
    expect(await service.getUnsettledUsage('meter')).toMatchObject({ alreadySettled: true, unsettledUsage: 0 });
    db.meterReading.findFirst.mockResolvedValueOnce(opening).mockResolvedValueOnce({ ...target, settledAt: end });
    expect(await service.getUnsettledUsage('meter', start.toISOString())).toMatchObject({ alreadySettled: true, estimatedAmount: 0 });
  });
  it('uses the earliest real baseline when old imports lack a cursor, blocks missing evidence and preserves account absence', async () => {
    db.meterReading.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce(null).mockResolvedValueOnce(opening);
    db.prepayAccount.findUnique.mockResolvedValue(null);
    expect(await service.getUnsettledUsage('meter')).toMatchObject({ baselineReadingId: 'base', prepayBalance: null });
    db.contract.findMany.mockResolvedValue([]);
    expect(await service.getUnsettledUsage('meter')).toMatchObject({ tenantName: null });
  });
  it('never advances a cursor on a blocked charge and records confirmed zero/vacant use', async () => {
    quote.mockResolvedValue(block);
    expect(await service.settleMeter('meter', {}, 'op')).toMatchObject({ status: 'BLOCKED', settled: false });
    expect(db.meterReading.update).not.toHaveBeenCalled();
    quote.mockResolvedValue(plan());
    const applyMock = vi.spyOn(service, 'applyReadingDeduction').mockResolvedValueOnce({ applied: false, ...block, unitPrice: 61.7 });
    expect(await service.settleMeter('meter', {}, 'op')).toMatchObject({ status: 'BLOCKED', settled: false });
    applyMock.mockRestore();
    quote.mockResolvedValue(plan({ usage: 0, amount: 0, prepayApplied: 0, receivableAmount: 0 }));
    expect(await service.settleMeter('meter', { notes: 'monthly' }, 'op')).toMatchObject({ status: 'NO_CHANGE', reasonCode: 'ZERO_USAGE', settled: true });
    quote.mockResolvedValue(plan({ amount: 0, prepayApplied: 0, receivableAmount: 0, account: null, policy: null, collectionMode: null, responsibility: { id: 'interval', responsibility: 'OWNER', contractId: null, tenantId: null } }));
    expect(await service.settleMeter('meter', {}, 'op')).toMatchObject({ status: 'NO_CHANGE', reasonCode: 'VACANT_INTERVAL', amount: 0 });
  });
  it('handles missing meters/readings and past or equal settled cursors without financial writes', async () => {
    db.meter.findUnique.mockResolvedValueOnce(null);
    await expect(service.settleMeter('missing', {}, 'op')).rejects.toBeInstanceOf(NotFoundException);
    db.meterReading.findFirst.mockResolvedValueOnce(null);
    await expect(service.settleMeter('meter', {}, 'op')).rejects.toBeInstanceOf(BadRequestException);
    for (const cursor of [{ ...target, settledAt: end }, { ...target, id: 'later', readingTime: new Date('2026-02-01'), settledAt: end }]) {
      db.meterReading.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce(cursor);
      expect(await service.settleMeter('meter', {}, 'op')).toMatchObject({ status: 'NO_CHANGE', amount: 0 });
    }
    expect(db.utilityCharge.create).not.toHaveBeenCalled();
  });
  it('clamps future cutoff, keeps structured batch outcomes, and refuses reserved notes', async () => {
    for (const call of [() => service.settleMeter('meter', { notes: '[SETTLED]' }, 'op'), () => service.settleBatch({ notes: '[INITIAL]' }, 'op'), () => service.confirmCharge('meter', { requestId: 'r', reviewToken: 'token', notes: '[SETTLED]' }, 'op')]) await expect(call()).rejects.toBeInstanceOf(BadRequestException);
    db.meterReading.findFirst.mockResolvedValue(null);
    const batch = await service.settleBatch({ meterIds: ['meter'], settleUntil: '2090-01-01' }, 'op');
    expect(batch).toMatchObject({ blockedCount: 1, results: [{ reasonCode: 'NO_READINGS' }] });
    expect(Date.parse(batch.settleUntil)).toBeLessThan(Date.parse('2090-01-01'));
    const custom = vi.fn().mockResolvedValueOnce({ meterId: 'meter', status: 'SETTLED' }).mockRejectedValueOnce(new NotFoundException()).mockRejectedValueOnce(new Error('private'));
    expect(await service.settleBatch({ meterIds: ['a', 'b', 'c'] }, 'op', custom)).toMatchObject({ settledCount: 1, failedCount: 2 });
    const queried = await service.settleBatch({ buildingId: 'building' }, 'op', async () => ({ meterId: 'meter', status: 'NO_CHANGE', settled: false, reasonCode: 'ALREADY_SETTLED', amount: 0, usage: 0 }));
    expect(queried.noChangeCount).toBe(1);
    db.meter.findMany.mockResolvedValue([]);
    expect((await service.settleBatch({}, 'op')).total).toBe(0);
  });
  it('requires the preview token, stores and replays the original confirmation, and rejects key conflicts', async () => {
    const info = await service.getUnsettledUsage('meter');
    const command = { requestId: 'request', notes: 'approved', reviewToken: ('reviewToken' in info ? info.reviewToken : '') };
    await expect(service.confirmCharge('meter', { ...command, reviewToken: 'stale' }, 'op')).rejects.toMatchObject({ response: { code: 'PREVIEW_STALE' } });
    const result = await service.confirmCharge('meter', command, 'op');
    expect(db.utilityPostingConfirmation.create).toHaveBeenCalled();
    expect(db.meterReading.update).toHaveBeenCalledWith({ where: { id: target.id }, data: expect.objectContaining({ notes: expect.stringContaining('备注:approved') }) });
    const saved = db.utilityPostingConfirmation.create.mock.calls[0][0].data;
    db.utilityPostingConfirmation.findUnique.mockResolvedValue(saved);
    expect(await service.confirmCharge('meter', command, 'op')).toEqual(result);
    await expect(service.confirmCharge('meter', { ...command, settleUntil: end.toISOString() }, 'op')).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    db.utilityPostingConfirmation.findUnique.mockResolvedValue(null);
    quote.mockResolvedValue(block);
    const blocked = await service.getUnsettledUsage('meter');
    await expect(service.confirmCharge('meter', { ...command, reviewToken: ('reviewToken' in blocked ? blocked.reviewToken : '') }, 'op')).rejects.toMatchObject({ response: { code: 'UTILITY_RULE_BLOCKED' } });
  });
});
