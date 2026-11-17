import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ContractsService } from './contracts.service.js';
import type { CreateContractDto } from './dto/create-contract.dto.js';
import type { ConfirmMoveInDto } from './dto/move-in.dto.js';
import { MoveInsController } from './move-ins.controller.js';
import { MoveInsService } from './move-ins.service.js';

const now = new Date('2026-11-17T09:00:00.000Z');
const room = { id: 'room-1', buildingId: 'building-1', status: 'VACANT', cleanStatus: 'CLEAN', version: 0 };
const terms: CreateContractDto = {
  roomId: room.id, buildingId: room.buildingId, tenantId: 'tenant-1',
  paymentCycle: 'MONTHLY' as CreateContractDto['paymentCycle'], paymentDay: 5, rentAmount: 10000, depositAmount: 20000,
  startDate: '2026-11-16', endDate: '2027-11-15',
};
const meter = { id: 'meter-1', meterNumber: 'M1', meterType: 'ELECTRICITY' };
const draft = {
  ...terms, id: 'lease-1', status: 'DRAFT', contractNumber: 'C-1', renewedFromId: null,
  startDate: new Date(terms.startDate), endDate: new Date(terms.endDate), updatedAt: now, leaseConfirmedAt: null,
};

function setup() {
  const clock = new BusinessClock({ get: () => 'Asia/Shanghai' } as never);
  vi.spyOn(clock, 'now').mockReturnValue(now);
  const tx = {
    $queryRaw: vi.fn(),
    room: { findUnique: vi.fn().mockResolvedValue(room), update: vi.fn().mockResolvedValue({ ...room, status: 'OCCUPIED' }) },
    contract: {
      findUnique: vi.fn().mockResolvedValue(draft), findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ ...draft, leaseConfirmedAt: now }),
    },
    tenant: { findUnique: vi.fn().mockResolvedValue({ name: '租客' }) },
    meter: { findMany: vi.fn().mockResolvedValue([meter]) },
    meterReading: {
      fields: { createdAt: 'createdAt' }, findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'reading-1' }),
    },
    moveInRequest: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    bill: {
      findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn(),
      findUniqueOrThrow: vi.fn()
        .mockResolvedValueOnce({ id: 'rent', amount: 5000, status: 'PENDING' })
        .mockResolvedValueOnce({ id: 'deposit', amount: 20000, status: 'PENDING' }),
    },
    prepayAccount: { upsert: vi.fn().mockResolvedValue({ id: 'account-1' }) },
  };
  const db = { ...tx, $transaction: vi.fn((callback: (db: typeof tx) => unknown) => callback(tx)) };
  const contracts = { createDraft: vi.fn().mockResolvedValue(draft) };
  const service = new MoveInsService(db as unknown as PrismaService, contracts as unknown as ContractsService, clock);
  async function request(data: Partial<ConfirmMoveInDto> = {}) {
    const selection = data.contractId ? { contractId: data.contractId } : { contract: data.contract ?? terms };
    const preview = await service.preview(room.id, selection);
    return {
      ...selection, reviewToken: preview.reviewToken, requestId: 'request-1',
      readings: [{ meterId: meter.id, currentReading: 10 }], ...data,
    };
  }
  return { tx, contracts, service, request };
}

describe('MoveInsService', () => {
  it('calculates only first-cycle rent and deposit, then records check-in', async () => {
    const { tx, contracts, service, request } = setup();
    const preview = await new MoveInsController(service).preview(room.id, { contract: terms });
    expect(preview.bills.map((bill) => bill.amount)).toEqual([5000, 20000]);
    expect(tx.bill.createMany).not.toHaveBeenCalled();
    const dto = await request();
    const result = await new MoveInsController(service).confirm(room.id, dto, { userId: 'admin', role: 'ADMIN' } as never);
    expect(result).toMatchObject({ billIds: ['rent', 'deposit'], baselines: [{ readingId: 'reading-1' }] });
    expect(contracts.createDraft).toHaveBeenCalledWith(terms, tx);
    expect(tx.room.update).toHaveBeenCalledTimes(1);
    expect(tx.moveInRequest.update).toHaveBeenCalledWith({ where: { requestId: dto.requestId }, data: { result } });
  });

  it('returns the persisted response on retry and rejects a changed payload', async () => {
    const { tx, service, request } = setup();
    const dto = await request();
    const first = await service.confirm(room.id, dto, 'admin');
    const data = tx.moveInRequest.create.mock.calls[0][0].data;
    tx.moveInRequest.findUnique.mockResolvedValue({ ...data, result: first });
    expect(await service.confirm(room.id, dto, 'admin')).toEqual(first);
    expect(tx.room.update).toHaveBeenCalledTimes(1);
    await expect(service.confirm(room.id, { ...dto, readings: [] }, 'admin')).rejects.toThrow(ConflictException);
  });

  it('rechecks the preview and requires one reading per assigned meter', async () => {
    const { service, tx, request } = setup();
    const dto = await request();
    await expect(service.confirm(room.id, { ...dto, reviewToken: 'stale' }, 'admin')).rejects.toThrow(ConflictException);
    await expect(service.confirm(room.id, { ...dto, readings: [] }, 'admin')).rejects.toThrow(BadRequestException);
    await expect(service.confirm(room.id, { ...dto, readings: [{ meterId: 'wrong', currentReading: 1 }] }, 'admin'))
      .rejects.toThrow(BadRequestException);
    expect(tx.bill.createMany).not.toHaveBeenCalled();
  });

  it('rejects invalid room and lease selections', async () => {
    const { service, tx } = setup();
    await expect(service.preview(room.id, {})).rejects.toThrow(BadRequestException);
    await expect(service.preview(room.id, { contract: { ...terms, roomId: 'other' } })).rejects.toThrow(BadRequestException);
    await expect(service.preview(room.id, { contract: { ...terms, startDate: '2027-01-01' } })).rejects.toThrow(ConflictException);
    tx.contract.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...draft, status: 'EXPIRED' });
    await expect(service.preview(room.id, { contractId: 'missing' })).rejects.toThrow(NotFoundException);
    await expect(service.preview(room.id, { contractId: draft.id })).rejects.toThrow(ConflictException);
    tx.room.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...room, cleanStatus: 'PENDING_CLEAN' });
    await expect(service.preview(room.id, { contract: terms })).rejects.toThrow(NotFoundException);
    await expect(service.preview(room.id, { contract: terms })).rejects.toThrow(ConflictException);
    tx.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(service.preview(room.id, { contract: terms })).rejects.toThrow(NotFoundException);
  });

  it('reuses verified existing bills and refuses conflicting or ambiguous ones', async () => {
    const { service, tx, request } = setup();
    const rent = { id: 'rent', amount: 5000, status: 'PENDING' };
    const deposit = { id: 'deposit', amount: 20000, status: 'PENDING' };
    tx.contract.findUnique.mockResolvedValue({ ...draft, status: 'ACTIVE', leaseConfirmedAt: now });
    const dto = await request({ contractId: draft.id });
    tx.bill.findMany.mockResolvedValueOnce([rent]).mockResolvedValueOnce([deposit]).mockResolvedValueOnce([rent, rent]);
    expect(await service.confirm(room.id, dto, 'admin')).toMatchObject({ billIds: ['rent', 'deposit'] });
    expect(tx.bill.createMany).not.toHaveBeenCalled();
    await expect(service.confirm(room.id, dto, 'admin')).rejects.toThrow(ConflictException);
    tx.bill.findMany.mockResolvedValueOnce([rent]);
    tx.bill.findUniqueOrThrow.mockResolvedValueOnce({ ...rent, status: 'CANCELLED' });
    await expect(service.confirm(room.id, dto, 'admin')).rejects.toThrow(ConflictException);
  });

  it('preserves the original cursor when the last sample is unsettled', async () => {
    const { service, tx, request } = setup();
    const dto = await request();
    tx.meterReading.findFirst.mockResolvedValueOnce({
      id: 'last', currentReading: 9, readingTime: new Date('2026-11-16'),
    });
    await expect(service.confirm(room.id, dto, 'admin')).rejects.toThrow(ConflictException);
    expect(tx.meterReading.create).not.toHaveBeenCalled();
    expect(tx.room.update).not.toHaveBeenCalled();
  });

  it('records known vacant consumption without charging and blocks unknown previous occupancy', async () => {
    const sample = { id: 'cursor', currentReading: 9, readingTime: new Date('2026-11-16'), settledAt: now };
    const known = setup();
    const knownRequest = await known.request();
    known.tx.meterReading.findFirst.mockResolvedValue(sample);
    await known.service.confirm(room.id, knownRequest, 'admin');
    expect(known.tx.meterReading.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ settledAmount: 0, settledUsage: 1, notes: expect.stringContaining('[VACANT_USAGE]') }),
    }));

    const unknown = setup();
    const unknownRequest = await unknown.request();
    unknown.tx.contract.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'old-lease' });
    unknown.tx.meterReading.findFirst.mockResolvedValue(sample);
    await expect(unknown.service.confirm(room.id, unknownRequest, 'admin')).rejects.toThrow(ConflictException);
  });
});
