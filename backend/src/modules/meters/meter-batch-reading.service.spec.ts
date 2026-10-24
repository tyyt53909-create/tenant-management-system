import { Test, TestingModule } from '@nestjs/testing';
import { MeterBatchReadingService } from './meter-batch-reading.service.js';
import { MeterBillingService } from './meter-billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('MeterBatchReadingService (T196 coverage)', () => {
  let service: MeterBatchReadingService;
  let prisma: any;
  let billing: any;

  const operatorId = 'admin-001';

  async function init(withBilling = true) {
    const prismaMock: any = {
      meter: { findUnique: vi.fn(), findMany: vi.fn() },
      meterReading: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      prepayAccount: { findMany: vi.fn() },
      meterPriceHistory: { findMany: vi.fn() },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    prismaMock.meterPriceHistory.findMany.mockResolvedValue([]);
    const billingMock: any = { applyReadingDeduction: vi.fn() };
    const providers: any[] = [
      MeterBatchReadingService,
      { provide: PrismaService, useValue: prismaMock },
    ];
    if (withBilling) providers.push({ provide: MeterBillingService, useValue: billingMock });
    const module: TestingModule = await Test.createTestingModule({ providers }).compile();
    service = module.get<MeterBatchReadingService>(MeterBatchReadingService);
    prisma = prismaMock;
    billing = billingMock;
  }

  beforeEach(async () => {
    await init(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- getBatchSheet ----------

  function sheetMeter(overrides: any = {}) {
    return {
      id: 'meter-001',
      meterNumber: 'M-001',
      meterType: 'ELECTRICITY',
      unitPrice: 100,
      buildingId: 'b-1',
      building: { id: 'b-1', name: 'A栋' },
      roomId: 'room-001',
      room: {
        id: 'room-001',
        roomNumber: '101',
        floor: 1,
        status: 'OCCUPIED',
        contracts: [
          { id: 'c-1', tenantId: 't-1', tenant: { id: 't-1', name: '张三', phone: '13800000000' } },
        ],
      },
      readings: [
        { id: 'r-1', currentReading: 100, previousReading: 90, usage: 10, readingTime: new Date('2026-10-10T10:00:00Z') },
      ],
      ...overrides,
    };
  }

  it('底表：带全部筛选 + 预付余额命中', async () => {
    prisma.meter.findMany.mockResolvedValue([sheetMeter()]);
    prisma.prepayAccount.findMany.mockResolvedValue([
      { roomId: 'room-001', tenantId: 't-1', balanceCache: 5000 },
    ]);
    const rows = await service.getBatchSheet({ buildingId: 'b-1', meterType: 'ELECTRICITY', floor: 1 });
    expect(prisma.meter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ buildingId: 'b-1', meterType: 'ELECTRICITY' }),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meterId: 'meter-001', tenantName: '张三', prepayBalance: 5000, lastReading: 100 });
  });

  it('底表：无筛选 + 无房间表 + 无合同 + 无读数（空预付对不查库）', async () => {
    prisma.meter.findMany.mockResolvedValue([
      sheetMeter({ id: 'meter-pub', roomId: null, room: null, building: null, readings: [] }),
      sheetMeter({
        id: 'meter-noc',
        room: { id: 'room-002', roomNumber: '102', floor: 1, status: 'VACANT', contracts: [] },
        readings: [],
      }),
    ]);
    const rows = await service.getBatchSheet({});
    expect(prisma.prepayAccount.findMany).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ roomNumber: '公共区域', tenantId: null, prepayBalance: null, lastReading: 0 });
    expect(rows[1]).toMatchObject({ tenantId: null, prepayBalance: null, lastUsage: 0 });
  });

  it('底表：有合同但无预付账户时余额兜底为 0', async () => {
    prisma.meter.findMany.mockResolvedValue([sheetMeter()]);
    prisma.prepayAccount.findMany.mockResolvedValue([]);
    const rows = await service.getBatchSheet({});
    expect(rows[0].prepayBalance).toBe(0);
  });

  it('构造时未注入 billingService 则内部创建默认实例（底表仍可用）', async () => {
    await init(false);
    prisma.meter.findMany.mockResolvedValue([]);
    const rows = await service.getBatchSheet({});
    expect(rows).toEqual([]);
  });

  // ---------- createBatchReadings ----------

  const baseMeterRow = {
    id: 'meter-001',
    meterNumber: 'M-001',
    isActive: true,
    roomId: 'room-001',
    room: { roomNumber: '101' },
  };

  it('批量：表不存在与已停用分别记行级失败', async () => {
    prisma.meter.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'missing') return null;
      if (where.id === 'inactive') return { ...baseMeterRow, id: 'inactive', isActive: false };
      return { ...baseMeterRow };
    });
    prisma.meterReading.findFirst.mockResolvedValue(null);
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-x', ...data }));
    const result = await service.createBatchReadings(
      {
        readings: [
          { meterId: 'missing', currentReading: 10 },
          { meterId: 'inactive', currentReading: 10 },
        ],
      } as any,
      operatorId,
    );
    expect(result).toMatchObject({ total: 2, successCount: 0, failureCount: 2 });
    expect(result.results[0]).toMatchObject({ success: false, error: '水电表不存在' });
    expect(result.results[1]).toMatchObject({ success: false, error: '水电表已停用' });
  });

  it('批量：messageId 命中已有记录则直接返回', async () => {
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains)
        return { id: 'r-old', currentReading: 100, previousReading: 90, usage: 10 };
      return null;
    });
    const result = await service.createBatchReadings(
      { readings: [{ meterId: 'meter-001', currentReading: 100, messageId: 'dup-1' }] } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, currentReading: 100, usage: 10 });
    expect(prisma.meterReading.create).not.toHaveBeenCalled();
  });

  it('批量：初始底数（备注+messageId）与默认初始文案两面', async () => {
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockResolvedValue(null);
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-i', ...data }));
    const result = await service.createBatchReadings(
      {
        readings: [
          { meterId: 'meter-001', currentReading: 50, isInitial: true, notes: '换表', messageId: 'init-1' },
          { meterId: 'meter-001', currentReading: 60, isInitial: true },
        ],
      } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, usage: 0, amount: 0 });
    expect(prisma.meterReading.create).toHaveBeenCalledTimes(2);
  });

  it('批量：无历史且 isInitial=false 走正常时序（起步值为 0）', async () => {
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockResolvedValue(null);
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-n', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: true, amount: 100, deducted: 100, shortfall: 0 });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.createBatchReadings(
      { readings: [{ meterId: 'meter-001', currentReading: 30, isInitial: false }] } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, previousReading: 0, usage: 30 });
  });

  it('批量：同一时间戳与读数重复上报直接返回', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      return { id: 'r-latest', readingTime: t, currentReading: 100, previousReading: 90, usage: 10 };
    });
    const result = await service.createBatchReadings(
      { readings: [{ meterId: 'meter-001', currentReading: 100, readingTime: t.toISOString() }] } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, currentReading: 100 });
    expect(prisma.meterReading.create).not.toHaveBeenCalled();
  });

  it('批量：乱序且后续存在更低读数、未允许翻转则记失败', async () => {
    const t2 = new Date('2026-10-12T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.readingTime?.gte)
        return { id: 'r-later', readingTime: t2, currentReading: 80 };
      return { id: 'r-latest', readingTime: t2, currentReading: 120 };
    });
    const result = await service.createBatchReadings(
      { readings: [{ meterId: 'meter-001', currentReading: 100, readingTime: '2026-10-09T10:00:00Z' }] } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: false });
    expect(result.results[0].error).toContain('乱序读数异常');
  });

  it('批量：乱序允许翻转、无前序记录时归档（备注+msgTag）', async () => {
    const t2 = new Date('2026-10-12T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.readingTime?.gte)
        return { id: 'r-later', readingTime: t2, currentReading: 60 };
      if (args?.where?.readingTime?.lte) return null;
      return { id: 'r-latest', readingTime: t2, currentReading: 120 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-ooo', ...data }));
    const result = await service.createBatchReadings(
      {
        readings: [
          {
            meterId: 'meter-001',
            currentReading: 90,
            readingTime: '2026-10-09T10:00:00Z',
            allowRollover: true,
            notes: '补录',
            messageId: 'ooo-1',
          },
        ],
      } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, usage: 0, amount: 0 });
  });

  it('批量：乱序无备注无msgId归档（备注分支另一面）', async () => {
    const t2 = new Date('2026-10-12T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.readingTime?.gte) return null;
      if (args?.where?.readingTime?.lte)
        return { id: 'r-pre', readingTime: new Date('2026-10-08T10:00:00Z'), currentReading: 70 };
      return { id: 'r-latest', readingTime: t2, currentReading: 120 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-ooo2', ...data }));
    const result = await service.createBatchReadings(
      {
        readings: [
          { meterId: 'meter-001', currentReading: 90, readingTime: '2026-10-09T10:00:00Z', allowRollover: true },
        ],
      } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, previousReading: 70, usage: 20 });
  });

  it('批量：乱序当前读数小于前序且未允许翻转则记失败', async () => {
    const t2 = new Date('2026-10-12T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.readingTime?.gte) return null;
      if (args?.where?.readingTime?.lte)
        return { id: 'r-pre', readingTime: new Date('2026-10-08T10:00:00Z'), currentReading: 200 };
      return { id: 'r-latest', readingTime: t2, currentReading: 220 };
    });
    const result = await service.createBatchReadings(
      { readings: [{ meterId: 'meter-001', currentReading: 150, readingTime: '2026-10-09T10:00:00Z' }] } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: false });
    expect(result.results[0].error).toContain('小于该时间之前的历史读数');
  });

  it('批量：正常时序倒走（小于上次读数）记失败', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      return { id: 'r-latest', readingTime: t, currentReading: 200 };
    });
    const result = await service.createBatchReadings(
      { readings: [{ meterId: 'meter-001', currentReading: 150, readingTime: '2026-10-11T10:00:00Z' }] } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: false, previousReading: 200 });
    expect(result.results[0].error).toContain('不能小于上次读数');
  });

  it('批量：显式 autoSettle + 备注 + messageId，结算成功后盖 SETTLED', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.OR) return null;
      return { id: 'r-latest', readingTime: t, currentReading: 100 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-s', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: true, amount: 500, deducted: 500, shortfall: 0 });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.createBatchReadings(
      {
        readings: [
          {
            meterId: 'meter-001',
            currentReading: 110,
            readingTime: '2026-10-11T10:00:00Z',
            autoSettle: true,
            notes: '抄表',
            messageId: 'settle-1',
          },
        ],
      } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, deducted: 500, shortfall: 0 });
    expect(prisma.meterReading.update).toHaveBeenCalledWith({
      where: { id: 'r-s' },
      data: expect.objectContaining({ notes: '抄表 [msgId:settle-1] [SETTLED]' }),
    });
  });

  it('批量：无备注无messageId结算成功，SETTLED 独立成备注', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.OR) return null;
      return { id: 'r-latest', readingTime: t, currentReading: 100 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-s2', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: true, amount: 500, deducted: 300, shortfall: 200 });
    prisma.meterReading.update.mockResolvedValue({});
    const result = await service.createBatchReadings(
      {
        readings: [
          { meterId: 'meter-001', currentReading: 110, readingTime: '2026-10-11T10:00:00Z', autoSettle: true },
        ],
      } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, deducted: 300, shortfall: 200 });
    expect(prisma.meterReading.update).toHaveBeenCalledWith({
      where: { id: 'r-s2' },
      data: expect.objectContaining({ notes: '[SETTLED]' }),
    });
  });

  it('批量：DEVICE 来源默认不结算', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meter.findUnique.mockResolvedValue({ ...baseMeterRow });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      return { id: 'r-latest', readingTime: t, currentReading: 100 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-d', ...data }));
    const result = await service.createBatchReadings(
      {
        readings: [
          { meterId: 'meter-001', currentReading: 110, readingTime: '2026-10-11T10:00:00Z', source: 'DEVICE' },
        ],
      } as any,
      operatorId,
    );
    expect(result.results[0]).toMatchObject({ success: true, amount: 0, deducted: 0 });
    expect(billing.applyReadingDeduction).not.toHaveBeenCalled();
    expect(prisma.meterReading.update).not.toHaveBeenCalled();
  });

  it('批量：一单多行混合成功与失败并汇总计数', async () => {
    const t = new Date('2026-10-10T10:00:00Z');
    prisma.meter.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'missing') return null;
      return { ...baseMeterRow, id: where.id };
    });
    prisma.meterReading.findFirst.mockImplementation(async (args: any) => {
      if (args?.where?.notes?.contains) return null;
      if (args?.where?.OR) return null;
      return { id: 'r-latest', readingTime: t, currentReading: 100 };
    });
    prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({ id: 'r-m', ...data }));
    billing.applyReadingDeduction.mockResolvedValue({ applied: false, amount: 0, deducted: 0, shortfall: 0 });
    const result = await service.createBatchReadings(
      {
        readings: [
          { meterId: 'meter-001', currentReading: 110, readingTime: '2026-10-11T10:00:00Z', autoSettle: true },
          { meterId: 'missing', currentReading: 10 },
        ],
      } as any,
      operatorId,
    );
    expect(result).toMatchObject({ total: 2, successCount: 1, failureCount: 1 });
  });
});
