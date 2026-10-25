import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeterReconciliationService } from './meter-reconciliation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { testPriceService } from './meter-test.providers.js';

describe('MeterReconciliationService', () => {
  let service: MeterReconciliationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      meter: { findMany: vi.fn() },
      meterReading: { findMany: vi.fn() },
      meterPriceHistory: { findMany: vi.fn().mockResolvedValue([]) },
      prepayTransaction: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ total: 0n }]),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MeterReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: MeterPriceService, useValue: testPriceService(prisma) },
      ],
    }).compile();
    service = moduleRef.get(MeterReconciliationService);
  });

  const meter = {
    id: 'm1',
    meterNumber: 'E-001',
    meterType: 'ELECTRICITY',
    unitPrice: 60,
    room: { roomNumber: '101' },
    publicArea: null,
  };

  it('读数、扣费、账单三方一致时 difference 为 0 且无问题', async () => {
    prisma.meter.findMany.mockResolvedValue([meter]);
    prisma.meterReading.findMany.mockResolvedValue([
      { id: 'r1', meterId: 'm1', currentReading: 100, usage: 0 },
      { id: 'r2', meterId: 'm1', currentReading: 150, usage: 50 },
    ]);
    prisma.prepayTransaction.findMany.mockResolvedValue([{ amount: -2000 }]);
    prisma.$queryRaw.mockResolvedValue([{ total: 1000n }]);

    const result = await service.reconcile({ period: '2026-01' });
    const row = result.rows[0];

    expect(row).toMatchObject({
      readingUsage: 50,
      recordedUsage: 50,
      readingConsistent: true,
      readingAmount: 3000,
      chargedAmount: 2000,
      billAmount: 1000,
      difference: 0,
      issues: [],
    });
    expect(result.summary).toMatchObject({ meters: 1, withIssues: 0, totalDifference: 0 });
  });

  it('扣费与应收不等时列出差额', async () => {
    prisma.meter.findMany.mockResolvedValue([meter]);
    prisma.meterReading.findMany.mockResolvedValue([
      { id: 'r1', meterId: 'm1', currentReading: 100, usage: 0 },
      { id: 'r2', meterId: 'm1', currentReading: 150, usage: 50 },
    ]);
    prisma.prepayTransaction.findMany.mockResolvedValue([{ amount: -1500 }]);

    const result = await service.reconcile({ period: '2026-01' });
    const row = result.rows[0];

    expect(row.difference).toBe(-1500);
    expect(row.issues).toContain('扣费+账单 1500 分 ≠ 应收 3000 分');
    expect(result.summary.withIssues).toBe(1);
  });

  it('读数差值与落库用量不一致时提示（乱序或补录）', async () => {
    prisma.meter.findMany.mockResolvedValue([meter]);
    prisma.meterReading.findMany.mockResolvedValue([
      { id: 'r1', meterId: 'm1', currentReading: 100, usage: 0 },
      { id: 'r2', meterId: 'm1', currentReading: 150, usage: 40 },
    ]);

    const result = await service.reconcile({ period: '2026-01' });

    expect(result.rows[0].readingConsistent).toBe(false);
    expect(result.rows[0].issues).toContain('读数差值 50 与落库用量 40 不一致');
  });

  it('本月读数不足两笔时提示无法核对', async () => {
    prisma.meter.findMany.mockResolvedValue([meter]);
    prisma.meterReading.findMany.mockResolvedValue([{ id: 'r1', meterId: 'm1', currentReading: 100, usage: 0 }]);

    const result = await service.reconcile({ period: '2026-01' });

    expect(result.rows[0].issues).toContain('本月读数不足两笔，无法核对');
  });

  it('没有表时返回空结果而不是报错', async () => {
    prisma.meter.findMany.mockResolvedValue([]);

    const result = await service.reconcile({ period: '2026-01' });

    expect(result.rows).toEqual([]);
    expect(result.summary.meters).toBe(0);
  });
});
