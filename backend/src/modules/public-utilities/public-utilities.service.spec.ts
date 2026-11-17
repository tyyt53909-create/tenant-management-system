import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicUtilitiesService } from './public-utilities.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { MeterPriceService } from '../meters/meter-price.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { ConfigService } from '@nestjs/config';

class UniqueViolation extends Error {
  code = 'P2002';
}

describe('PublicUtilitiesService', () => {
  let service: PublicUtilitiesService;
  let prisma: any;
  let audit: { log: ReturnType<typeof vi.fn> };

  const actor = { userId: 'admin-1', ip: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(async () => {
    prisma = {
      building: { findUnique: vi.fn().mockResolvedValue({ id: 'building-001' }) },
      meter: { findFirst: vi.fn() },
      meterReading: { fields: { createdAt: Symbol('meterReading.createdAt') }, findMany: vi.fn() },
      meterPriceHistory: { findMany: vi.fn().mockResolvedValue([]) },
      contract: { findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn() },
      room: { findMany: vi.fn().mockResolvedValue([]) },
      publicUtilityBill: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      },
      bill: { findUnique: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(prisma)),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicUtilitiesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
        // QLT-02 / T288：计价服务改为必填
        {
          provide: MeterPriceService,
          useValue: new MeterPriceService(
            prisma as never,
            new BusinessClock(new ConfigService({ NODE_ENV: 'test' })),
          ),
        },
      ],
    }).compile();
    service = moduleRef.get(PublicUtilitiesService);
  });

  it('按公共表当月首尾读数算用量与总额', async () => {
    prisma.meter.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 60 });
    prisma.meterReading.findMany.mockResolvedValue([
      { currentReading: 100.5, source: 'MANUAL' },
      { currentReading: 250.75, source: 'MANUAL' },
    ]);
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', roomId: 'r1', room: { area: 30 } },
      { id: 'c2', roomId: 'r2', room: { area: 70 } },
    ]);

    const result = await service.preview({ meterType: 'ELECTRICITY', period: '2026-01', meterId: 'm1' });

    expect(result.usage).toBe(150.25);
    expect(result.totalAmount).toBe(9015);
    expect(result.allocations.map((allocation) => allocation.amount)).toEqual([2704, 6311]);
    expect(result.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(result.totalAmount);
  });

  it('公共表不足两笔读数 → 400', async () => {
    prisma.meter.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 60 });
    prisma.meterReading.findMany.mockResolvedValue([{ currentReading: 100 }]);

    await expect(service.preview({ meterType: 'ELECTRICITY', period: '2026-01', meterId: 'm1' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('末读数小于首读数 → 400', async () => {
    prisma.meter.findFirst.mockResolvedValue({ id: 'm1', unitPrice: 60 });
    prisma.meterReading.findMany.mockResolvedValue([{ currentReading: 200 }, { currentReading: 100 }]);

    await expect(service.preview({ meterType: 'ELECTRICITY', period: '2026-01', meterId: 'm1' })).rejects.toThrow(
      /末读数小于月初读数/,
    );
  });

  it('既没给公共表也没给总额 → 400', async () => {
    await expect(service.preview({ meterType: 'WATER', period: '2026-01' })).rejects.toThrow(/直接录入总额/);
  });

  it('没有生效合同 → 分摊为空并给出提示', async () => {
    const result = await service.preview({ meterType: 'WATER', period: '2026-01', totalAmount: 5000 });

    expect(result.allocations).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('创建时把分摊明细一并写入', async () => {
    prisma.contract.findMany.mockResolvedValue([{ id: 'c1', roomId: 'r1', room: { area: 50 } }]);
    prisma.publicUtilityBill.create.mockResolvedValue({ id: 'pu1', period: '2026-01', totalAmount: 5000, allocations: [], billsGeneratedAt: null });

    await service.create({ meterType: 'WATER', period: '2026-01', totalAmount: 5000 }, actor);

    const data = prisma.publicUtilityBill.create.mock.calls[0][0].data;
    expect(data.allocations.create).toEqual([
      { contractId: 'c1', roomId: 'r1', baseAreaHundredths: 5000, amount: 5000 },
    ]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PUBLIC_UTILITY_CREATE' }));
  });

  it('同楼栋同表类型同账期重复 → 409', async () => {
    prisma.publicUtilityBill.create.mockRejectedValue(new UniqueViolation());

    await expect(service.create({ meterType: 'WATER', period: '2026-01', totalAmount: 5000 }, actor)).rejects.toThrow(
      ConflictException,
    );
  });

  it('缺少已确认分摊规则和责任来源时保留单据并阻断出账', async () => {
    prisma.publicUtilityBill.findUnique.mockResolvedValue({ id: 'pu1', billsGeneratedAt: null, allocations: [{ amount: 4000 }] });
    await expect(service.generateBills('pu1', actor)).rejects.toMatchObject({ response: { code: 'UTILITY_RULE_BLOCKED' } });
    expect(prisma.bill.create).not.toHaveBeenCalled();
    expect(prisma.publicUtilityBill.update).not.toHaveBeenCalled();
  });

  it('重复生成 → 400', async () => {
    prisma.publicUtilityBill.findUnique.mockResolvedValue({
      id: 'pu1',
      billsGeneratedAt: new Date(),
      allocations: [],
    });

    await expect(service.generateBills('pu1', actor)).rejects.toThrow(/已生成/);
  });
});
