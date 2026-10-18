import { Test, TestingModule } from '@nestjs/testing';
import { MeterReadingService } from './meter-reading.service.js';
import { MeterBillingService } from './meter-billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('MeterReadingService (T196 coverage)', () => {
  let service: MeterReadingService;
  let prisma: any;
  let billing: any;

  const meterId = 'meter-001';
  const operatorId = 'admin-001';

  const baseMeter = {
    id: meterId,
    meterType: 'ELECTRICITY',
    meterNumber: 'M-001',
    unitPrice: 100,
    roomId: 'room-001',
    isActive: true,
  };

  function buildModule() {
    const prismaMock: any = {
      meter: { findUnique: vi.fn() },
      meterReading: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    const billingMock: any = { applyReadingDeduction: vi.fn() };
    return { prismaMock, billingMock };
  }

  async function init(withBilling = true) {
    const { prismaMock, billingMock } = buildModule();
    const providers: any[] = [
      MeterReadingService,
      { provide: PrismaService, useValue: prismaMock },
    ];
    if (withBilling) providers.push({ provide: MeterBillingService, useValue: billingMock });
    const module: TestingModule = await Test.createTestingModule({ providers }).compile();
    service = module.get<MeterReadingService>(MeterReadingService);
    prisma = prismaMock;
    billing = billingMock;
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeter });
  }

  beforeEach(async () => {
    await init(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('构造时未注入 billingService 则内部创建默认实例（findReadings 仍可用）', async () => {
    await init(false);
    prisma.meterReading.findMany.mockResolvedValue([]);
    prisma.meterReading.count.mockResolvedValue(0);
    const result = await service.findReadings(meterId, {});
    expect(result.meta.total).toBe(0);
  });

  it('初始底数 + 备注 + messageId：messageId 未命中时走初始登记并拼接备注', async () => {
    prisma.meterReading.findFirst.mockResolvedValue(null);
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-init', ...data }));
    const result = await service.createReading(
      meterId,
      { currentReading: 100, isInitial: true, notes: '换表', messageId: 'msg-1' } as any,
      operatorId,
    );
    expect(result.reading.notes).toContain('[INITIAL]');
    expect(result.reading.notes).toContain('[msgId:msg-1]');
    expect(result.deduction).toMatchObject({ applied: false });
  });

  it('无历史且 isInitial=false：按正常时序以 0 为起步值并走结算基线查询', async () => {
    // findFirst 调用顺序：latest(null) -> lastSettled(null)
    prisma.meterReading.findFirst.mockResolvedValue(null);
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-1', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: true, amount: 5000, deducted: 5000, shortfall: 0 });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.createReading(
      meterId,
      { currentReading: 50, isInitial: false } as any,
      operatorId,
    );
    expect(result.reading.usage).toBe(50);
    expect(billing.applyReadingDeduction).toHaveBeenCalled();
    expect(prisma.meterReading.update).toHaveBeenCalled();
  });

  it('正常时序 + 备注 + messageId：备注拼接到 msgTag', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.OR) return null;
      return { id: 'r-prev', readingTime: t, currentReading: 50 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-2', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: false, reason: '余额不足挂账' });
    const result = await service.createReading(
      meterId,
      { currentReading: 60, readingTime: '2026-10-11T10:00:00Z', notes: '人工抄表', messageId: 'msg-2' } as any,
      operatorId,
    );
    expect(result.reading.notes).toContain('人工抄表 [msgId:msg-2]');
    expect(billing.applyReadingDeduction).toHaveBeenCalled();
  });

  it('正常时序 + messageId 无备注：备注仅为 msgTag', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.OR) return null;
      return { id: 'r-prev', readingTime: t, currentReading: 50 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-3', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: false, reason: '未结算' });
    const result = await service.createReading(
      meterId,
      { currentReading: 70, readingTime: '2026-10-11T10:00:00Z', messageId: 'msg-3' } as any,
      operatorId,
    );
    expect(result.reading.notes).toBe('[msgId:msg-3]');
  });

  it('乱序上报命中完全重复历史：直接返回历史记录', async () => {
    const t2 = new Date('2026-10-12T10:00:00Z');
    const dup = { id: 'r-dup', readingTime: new Date('2026-10-09T10:00:00Z'), currentReading: 40 };
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.readingTime instanceof Date) return dup;
      return { id: 'r-latest', readingTime: t2, currentReading: 90 };
    });
    const result = await service.createReading(
      meterId,
      { currentReading: 40, readingTime: '2026-10-09T10:00:00Z' } as any,
      operatorId,
    );
    expect(result.reading.id).toBe('r-dup');
  });

  it('乱序上报无前序记录：prevVal 取当前读数并归档（备注+msgTag）', async () => {
    const t2 = new Date('2026-10-12T10:00:00Z');
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.readingTime instanceof Date) return null;
      if (args?.where?.readingTime?.gte) return null;
      if (args?.where?.readingTime?.lte) return null;
      return { id: 'r-latest', readingTime: t2, currentReading: 90 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-ooo', ...data }));
    const result = await service.createReading(
      meterId,
      { currentReading: 80, readingTime: '2026-10-09T10:00:00Z', notes: '补录', messageId: 'msg-ooo' } as any,
      operatorId,
    );
    expect(result.reading.usage).toBe(0);
    expect(result.reading.notes).toContain('[OUT_OF_ORDER]');
    expect(result.reading.notes).toContain('[msgId:msg-ooo]');
  });

  it('乱序上报当前读数小于前序且未允许翻转：抛错', async () => {
    const t2 = new Date('2026-10-12T10:00:00Z');
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.readingTime instanceof Date) return null;
      if (args?.where?.readingTime?.gte) return null;
      if (args?.where?.readingTime?.lte)
        return { id: 'r-pre', readingTime: new Date('2026-10-08T10:00:00Z'), currentReading: 100 };
      return { id: 'r-latest', readingTime: t2, currentReading: 120 };
    });
    await expect(
      service.createReading(
        meterId,
        { currentReading: 90, readingTime: '2026-10-09T10:00:00Z' } as any,
        operatorId,
      ),
    ).rejects.toThrow('小于该时间之前的历史读数');
  });

  it('自动结算成功且读数有备注：SETTLED 盖印拼接到原备注后', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.OR) return { id: 'r-settled', currentReading: 50, readingTime: t };
      return { id: 'r-prev', readingTime: t, currentReading: 50 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-4', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: true, amount: 1000, deducted: 1000, shortfall: 0 });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.createReading(
      meterId,
      { currentReading: 60, readingTime: '2026-10-11T10:00:00Z', notes: '备注A' } as any,
      operatorId,
    );
    expect(prisma.meterReading.update).toHaveBeenCalledWith({
      where: { id: 'r-4' },
      data: { notes: '备注A [SETTLED]' },
    });
    expect(result.reading.notes).toBe('备注A [SETTLED]');
  });
});
