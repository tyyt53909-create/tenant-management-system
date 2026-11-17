import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import type { MeterBatchReadingService } from '../meters/meter-batch-reading.service.js';
import type { MeterBillingService } from '../meters/meter-billing.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { PeriodicChargesController } from './periodic-charges.controller.js';
import { PeriodicChargesService } from './periodic-charges.service.js';

const cutoff = new Date('2026-11-17T09:00:00Z');
const batch = { id: 'batch', buildingId: 'building', cutoff, version: 0, period: '2026-11', confirmedBy: 'admin' };
const item = { id: 'item', targetId: 'meter', label: '表计', kind: 'UTILITY', batchId: batch.id, batch };
const lease = {
  id: 'lease', roomId: 'room', status: 'ACTIVE', tenantId: 'tenant', tenant: { userId: 'user' },
  contractNumber: 'C-123', startDate: new Date('2026-11-01'), endDate: new Date('2027-11-30'),
  paymentCycle: 'MONTHLY', paymentDay: 1, rentAmount: 10000,
};
const meterPreview = {
  hasReadings: true, readingTime: cutoff, contractId: lease.id, currentReading: 105,
  unsettledUsage: 5, estimatedAmount: 500, prepayBalance: 300, targetReadingId: 'reading',
  baselineReadingId: 'baseline', segments: [],
};

function setup() {
  const clock = new BusinessClock({ get: () => 'Asia/Shanghai' } as never);
  vi.spyOn(clock, 'now').mockReturnValue(cutoff);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn(),
    building: { findUnique: vi.fn().mockResolvedValue({ id: 'building' }) },
    contract: {
      findMany: vi.fn().mockResolvedValue([lease]), findFirst: vi.fn().mockResolvedValue(lease),
      findUnique: vi.fn().mockResolvedValue(lease),
    },
    meter: { findMany: vi.fn().mockResolvedValue([{ id: 'meter', meterNumber: '表计' }]), findFirst: vi.fn().mockResolvedValue({ id: 'meter' }) },
    bill: {
      findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'bill' }),
    },
    periodicChargeBatch: {
      findMany: vi.fn().mockResolvedValue([batch]), findUnique: vi.fn().mockResolvedValue({ ...batch, items: [] }),
      create: vi.fn().mockResolvedValue(batch), update: vi.fn(),
    },
    periodicChargeItem: {
      findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn().mockResolvedValue(item),
      count: vi.fn().mockResolvedValue(0), update: vi.fn(), createMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const readings = { createBatchReadings: vi.fn() };
  const billing = {
    getUnsettledUsage: vi.fn().mockResolvedValue(meterPreview),
    settleMeterInTransaction: vi.fn().mockResolvedValue({
      status: 'SETTLED', reasonCode: 'SETTLED', reason: '结算完成',
      amount: 500, contractId: lease.id, billId: 'utility', prepayTransactionId: 'debit',
    }),
  };
  const notices = { create: vi.fn().mockResolvedValue({ id: 'notice' }) };
  const db = { ...tx, $transaction: vi.fn((callback: (db: typeof tx) => unknown) => callback(tx)) };
  const service = new PeriodicChargesService(
    db as unknown as PrismaService, clock, readings as unknown as MeterBatchReadingService,
    billing as unknown as MeterBillingService, notices as unknown as NotificationsService,
  );
  const controller = new PeriodicChargesController(service);
  const admin = { userId: 'admin', role: 'ADMIN' } as never;
  async function preview() {
    await controller.preview({ buildingId: batch.buildingId, cutoff: cutoff.toISOString() }, admin);
    return tx.periodicChargeItem.createMany.mock.calls.at(-1)![0].data as { kind: string; review: object }[];
  }
  function execute(data: object) {
    tx.$queryRaw.mockResolvedValueOnce([{ id: item.id }]);
    tx.periodicChargeItem.findUniqueOrThrow.mockResolvedValueOnce({ ...item, ...data });
    return service.processNext();
  }
  return { tx, billing, readings, notices, service, controller, admin, preview, execute };
}

describe('PeriodicChargesService', () => {
  it('collects without auto charging and persists an uncharged preview', async () => {
    const { tx, billing, readings, controller, admin, preview } = setup();
    await controller.collect({ readings: [{ meterId: 'meter', currentReading: 105, autoSettle: true }] }, admin);
    expect(readings.createBatchReadings).toHaveBeenCalledWith({
      readings: [{ meterId: 'meter', currentReading: 105, autoSettle: false }],
    }, 'admin');
    expect(await preview()).toMatchObject([
      { kind: 'RENT', state: 'READY', review: { amount: 10000 } },
      { kind: 'UTILITY', state: 'READY', review: { amount: 500 } },
    ]);
    expect(tx.bill.createMany).not.toHaveBeenCalled();
    expect(billing.settleMeterInTransaction).not.toHaveBeenCalled();
  });

  it('validates cutoff and unknown buildings', async () => {
    const { tx, service } = setup();
    const input = { buildingId: 'building', cutoff: cutoff.toISOString() };
    await expect(service.preview({ ...input, cutoff: '2026-11-17' }, 'admin')).rejects.toThrow(BadRequestException);
    await expect(service.preview({ ...input, cutoff: '2027-11-01T12:00Z' }, 'admin')).rejects.toThrow(BadRequestException);
    tx.building.findUnique.mockResolvedValueOnce(null);
    await expect(service.preview(input, 'admin')).rejects.toThrow(NotFoundException);
  });

  it('classifies unavailable meters, missing readings, past charges, stale handoffs, occupancy and accounts', async () => {
    const { tx, billing, preview } = setup();
    tx.meter.findFirst.mockResolvedValueOnce(null);
    expect((await preview())[1]).toMatchObject({ state: 'BLOCKED', review: { reasonCode: 'METER_UNAVAILABLE' } });
    for (const [result, code] of [
      [{ hasReadings: false }, 'NO_READINGS'],
      [{ alreadySettled: true }, 'ALREADY_SETTLED'],
      [{ settlementBlock: { reasonCode: 'UNCONFIRMED_HANDOFF', reason: '待确认', retryCondition: '核对' } }, 'UNCONFIRMED_HANDOFF'],
      [{ attribution: { reasonCode: 'OCCUPANCY_UNCERTAIN', reason: '归属不明', retryCondition: '核对' } }, 'OCCUPANCY_UNCERTAIN'],
      [{ prepayBalance: null, collectionMode: 'PREPAY_WITH_SHORTFALL' }, 'MISSING_PREPAY_ACCOUNT'],
    ] as const) {
      billing.getUnsettledUsage.mockResolvedValueOnce({ ...meterPreview, ...result });
      expect((await preview())[1]).toMatchObject({ review: { reasonCode: code } });
    }
  });

  it('classifies inactive leases, non-anchor months, and existing rent bills', async () => {
    const { tx, preview } = setup();
    tx.contract.findFirst.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...lease, startDate: new Date('2026-10-01'), paymentCycle: 'QUARTERLY' });
    expect((await preview())[0]).toMatchObject({ state: 'BLOCKED', review: { reasonCode: 'LEASE_NOT_ACTIVE' } });
    expect((await preview())[0]).toMatchObject({ state: 'NO_CHANGE', review: { reasonCode: 'NO_RENT_DUE' } });
    tx.bill.findFirst.mockResolvedValueOnce({ id: 'legacy' });
    expect((await preview())[0]).toMatchObject({ state: 'NO_CHANGE', result: { billId: 'legacy' } });
  });

  it('attaches current payment information to persisted results and paginates history', async () => {
    const { tx, controller } = setup();
    tx.periodicChargeBatch.findUnique.mockResolvedValueOnce({ ...batch, items: [
      { result: { billId: 'legacy' } }, { result: 42 }, { result: { billId: 42 } },
    ] });
    tx.bill.findMany.mockResolvedValueOnce([{ id: 'legacy', paidAmount: 120, amount: 210, status: 'PARTIAL' }]);
    expect(await controller.detail('batch')).toMatchObject({ bills: [{ id: 'legacy', status: 'PARTIAL' }] });
    expect(tx.bill.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['legacy'] } });
    expect(await controller.list('older')).toEqual([batch]);
    expect(tx.periodicChargeBatch.findMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: 'older' }, skip: 1 }));
    tx.periodicChargeBatch.findUnique.mockResolvedValueOnce(null);
    await expect(controller.detail('missing')).rejects.toThrow(NotFoundException);
  });

  it('queues only ready items and rechecks eligible rows under the batch version lock', async () => {
    const { tx, controller, admin } = setup();
    await expect(controller.confirm('batch', { version: 1 }, admin)).rejects.toThrow(ConflictException);
    tx.periodicChargeItem.count.mockResolvedValueOnce(1);
    await expect(controller.recheck('batch', { version: 0 })).rejects.toThrow(ConflictException);
    tx.periodicChargeItem.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(controller.confirm('batch', { version: 0 }, admin)).rejects.toThrow(ConflictException);
    tx.periodicChargeBatch.findUnique.mockResolvedValueOnce(null);
    await expect(controller.confirm('missing', { version: 0 }, admin)).rejects.toThrow(NotFoundException);

    tx.periodicChargeItem.findMany.mockResolvedValueOnce([item]);
    await controller.recheck('batch', { version: 0 });
    expect(tx.periodicChargeItem.findMany).toHaveBeenCalledWith({
      where: { batchId: 'batch', state: { in: ['BLOCKED', 'FAILED', 'READY'] } },
    });
    expect(tx.periodicChargeItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'READY' }) }));
    await controller.confirm('batch', { version: 0 }, admin);
    expect(tx.periodicChargeItem.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { batchId: 'batch', state: 'READY' }, data: expect.objectContaining({ state: 'QUEUED' }),
    }));
  });

  it('executes rent idempotently and records existing or changed approvals', async () => {
    const { tx, service, preview, execute } = setup();
    const [rent] = await preview();
    expect(await service.processNext()).toBe(false);
    const input = { kind: 'RENT', targetId: lease.id, review: rent.review };
    await execute(input);
    expect(tx.periodicChargeItem.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'SETTLED', notificationState: 'PENDING', result: { state: 'SETTLED', reasonCode: 'BILL_CREATED', amount: 10000, billId: 'bill', confirmedBy: 'admin' } }),
    }));
    tx.bill.createMany.mockResolvedValueOnce({ count: 0 });
    await execute(input);
    tx.bill.findFirst.mockResolvedValueOnce({ id: 'legacy' });
    await execute(input);
    await execute({ ...input, review: { fingerprint: 'stale' } });
    expect(tx.periodicChargeItem.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'BLOCKED', result: expect.objectContaining({ reasonCode: 'STALE_REVIEW' }) }),
    }));
  });

  it('records charges or rolls back failures and changed amounts without advancing the result', async () => {
    const { tx, billing, preview, execute } = setup();
    const [, utility] = await preview();
    const input = { review: utility.review };
    await execute(input);
    expect(tx.periodicChargeItem.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'SETTLED', result: expect.objectContaining({ billId: 'utility', prepayTransactionId: 'debit' }) }),
    }));
    billing.settleMeterInTransaction.mockRejectedValueOnce(new Error('write error'));
    await execute(input);
    expect(tx.$executeRaw.mock.calls.some(([sql]) => String(sql).includes('ROLLBACK TO SAVEPOINT'))).toBe(true);
    expect(tx.periodicChargeItem.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'FAILED', notificationState: null }),
    }));
    billing.settleMeterInTransaction.mockResolvedValueOnce({ status: 'SETTLED', amount: 600, contractId: 'lease' });
    await execute(input);
    expect(tx.periodicChargeItem.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'BLOCKED', result: expect.objectContaining({ reasonCode: 'STALE_REVIEW' }) }),
    }));
    billing.getUnsettledUsage.mockResolvedValueOnce({ ...meterPreview, alreadySettled: true });
    await execute(input);
    expect(tx.periodicChargeItem.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'NO_CHANGE' }),
    }));
    await execute({ ...input, review: { fingerprint: 'wrong' } });
  });

  it('retries notification independently of the financial result', async () => {
    const { tx, notices, service, controller } = setup();
    const charge = { ...item, notificationUserId: 'user', result: { billId: 'bill' } };
    tx.periodicChargeItem.findMany.mockResolvedValue([charge]);
    notices.create.mockResolvedValueOnce(undefined as never);
    await service.drain();
    expect(tx.periodicChargeItem.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { notificationState: 'FAILED' } }));
    await controller.retryNotices('batch');
    await service.deliverPending();
    expect(notices.create).toHaveBeenCalledWith(expect.objectContaining({ dedupKey: 'PERIODIC_CHARGE:item', userId: 'user' }));
    expect(tx.periodicChargeItem.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { notificationState: 'DELIVERED', notificationId: 'notice' } }));
    expect(tx.bill.createMany).not.toHaveBeenCalled();
  });
});
