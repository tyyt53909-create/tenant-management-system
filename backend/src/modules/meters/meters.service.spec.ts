import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MetersService } from './meters.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('MetersService', () => {
  let service: MetersService;
  let prisma: any;

  const meterId = 'meter-001';
  const operatorId = 'admin-001';

  const baseMeter = {
    id: meterId,
    meterType: 'ELECTRICITY',
    meterNumber: 'M-001',
    unitPrice: 100,
    roomId: 'room-001',
    publicAreaId: null,
    isActive: true,
  };

  beforeEach(async () => {
    const prismaMock: any = {
      meter: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      meterReading: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
      contract: { findFirst: vi.fn() },
      prepayAccount: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      prepayTransaction: { create: vi.fn() },
      bill: { create: vi.fn() },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetersService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<MetersService>(MetersService);
    prisma = prismaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createReading', () => {
    it('首次读数：previous=0，余额充足全额扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-1',
        ...data,
      }));
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 50000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({
        id: 'account-1',
        balanceCache: 30000,
      });
      prisma.prepayTransaction.create.mockResolvedValue({ id: 'tx-1' });

      const result = await service.createReading(
        meterId,
        { currentReading: 200 } as any,
        operatorId,
      );

      // usage 200 × 单价 100 = 20000 分，全额扣费
      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ previousReading: 0, usage: 200, source: 'MANUAL' }),
      });
      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'account-1', balanceCache: { gte: 20000 } },
        data: { balanceCache: { decrement: 20000 } },
      });
      expect(prisma.prepayTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DEDUCTION',
          amount: -20000,
          balanceAfter: 30000,
          relatedId: 'reading-1',
          relatedType: 'METER_READING',
        }),
      });
      expect(prisma.bill.create).not.toHaveBeenCalled();
      expect(result.deduction.applied).toBe(true);
      expect(result.deduction.shortfall).toBe(0);
    });

    it('非首次读数：usage = 本次 - 上次', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 150 });
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-2',
        ...data,
      }));
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 50000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 45000 });
      prisma.prepayTransaction.create.mockResolvedValue({ id: 'tx-2' });

      await service.createReading(meterId, { currentReading: 200 } as any, operatorId);

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ previousReading: 150, usage: 50 }),
      });
      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'account-1', balanceCache: { gte: 5000 } },
        data: { balanceCache: { decrement: 5000 } },
      });
    });

    it('余额不足：扣尽余额 + 差额生成 UTILITY 补缴账单', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-3',
        ...data,
      }));
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 3000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 0 });
      prisma.prepayTransaction.create.mockResolvedValue({ id: 'tx-3' });
      prisma.bill.create.mockResolvedValue({ id: 'bill-1' });

      const result = await service.createReading(
        meterId,
        { currentReading: 200 } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'account-1', balanceCache: { gte: 3000 } },
        data: { balanceCache: { decrement: 3000 } },
      });
      expect(prisma.bill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contractId: 'contract-1',
          billType: 'UTILITY',
          amount: 17000, // 20000 - 3000
          snapshot: expect.objectContaining({
            usage: 200,
            unitPrice: 100,
            totalAmount: 20000,
            deducted: 3000,
            shortfall: 17000,
          }),
        }),
      });
      expect(result.deduction).toEqual(
        expect.objectContaining({ applied: true, amount: 20000, deducted: 3000, shortfall: 17000 }),
      );
    });

    it('余额为 0：不扣费，全额生成补缴账单', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-4',
        ...data,
      }));
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'account-1', balanceCache: 0 });
      prisma.bill.create.mockResolvedValue({ id: 'bill-2' });

      const result = await service.createReading(
        meterId,
        { currentReading: 100 } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.updateMany).not.toHaveBeenCalled();
      expect(prisma.prepayTransaction.create).not.toHaveBeenCalled();
      expect(prisma.bill.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ billType: 'UTILITY', amount: 10000 }),
      });
      expect(result.deduction.deducted).toBe(0);
    });

    it('无生效合同：不扣费（返回原因），仍保存读数', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-5',
        ...data,
      }));
      prisma.contract.findFirst.mockResolvedValue(null);

      const result = await service.createReading(
        meterId,
        { currentReading: 100 } as any,
        operatorId,
      );

      expect(prisma.prepayAccount.findUnique).not.toHaveBeenCalled();
      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('合同');
    });

    it('无预付账户：不扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-6',
        ...data,
      }));
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', tenantId: 'tenant-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue(null);

      const result = await service.createReading(
        meterId,
        { currentReading: 100 } as any,
        operatorId,
      );

      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('预付账户');
    });

    it('公共区域表：不扣费（运营成本）', async () => {
      prisma.meter.findUnique.mockResolvedValue({
        ...baseMeter,
        roomId: null,
        publicAreaId: 'area-1',
      });
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-7',
        ...data,
      }));

      const result = await service.createReading(
        meterId,
        { currentReading: 100 } as any,
        operatorId,
      );

      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('公共区域');
    });

    it('用量为 0：不扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 200 });
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-8',
        ...data,
      }));

      const result = await service.createReading(
        meterId,
        { currentReading: 200 } as any,
        operatorId,
      );

      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('用量');
    });

    it('读数小于上次：400，不写入', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 250 });

      await expect(
        service.createReading(meterId, { currentReading: 200 } as any, operatorId),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('表不存在：404', async () => {
      prisma.meter.findUnique.mockResolvedValue(null);

      await expect(
        service.createReading(meterId, { currentReading: 100 } as any, operatorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('表已停用：400', async () => {
      prisma.meter.findUnique.mockResolvedValue({ ...baseMeter, isActive: false });

      await expect(
        service.createReading(meterId, { currentReading: 100 } as any, operatorId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findReadings', () => {
    it('表不存在：404', async () => {
      prisma.meter.findUnique.mockResolvedValue(null);

      await expect(service.findReadings(meterId, {})).rejects.toThrow(NotFoundException);
    });

    it('分页倒序返回读数', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      const records = [{ id: 'r-2' }, { id: 'r-1' }];
      prisma.meterReading.findMany.mockResolvedValue(records);
      prisma.meterReading.count.mockResolvedValue(2);

      const result = await service.findReadings(meterId, { page: 1, limit: 20 });

      expect(result.data).toEqual(records);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(prisma.meterReading.findMany).toHaveBeenCalledWith({
        where: { meterId },
        skip: 0,
        take: 20,
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('getBatchSheet', () => {
    it('正确按筛选聚合房间、租客、最新读数与预付余额', async () => {
      const mockMeters = [
        {
          id: 'meter-001',
          meterNumber: 'E-101',
          meterType: 'ELECTRICITY',
          unitPrice: 120,
          buildingId: 'b-01',
          roomId: 'r-101',
          building: { name: '1号楼' },
          room: {
            roomNumber: '101',
            floor: 1,
            status: 'OCCUPIED',
            contracts: [{ id: 'c-1', tenantId: 't-1', tenant: { id: 't-1', name: '张三', phone: '13800000001' } }],
          },
          readings: [{ currentReading: 150, previousReading: 100, usage: 50, readingTime: new Date('2026-10-01') }],
        },
      ];
      prisma.meter.findMany.mockResolvedValue(mockMeters);
      prisma.prepayAccount.findMany.mockResolvedValue([
        { roomId: 'r-101', tenantId: 't-1', balanceCache: 8800 },
      ]);

      const sheet = await service.getBatchSheet({ buildingId: 'b-01', meterType: 'ELECTRICITY' });

      expect(sheet).toHaveLength(1);
      expect(sheet[0]).toEqual({
        meterId: 'meter-001',
        meterNumber: 'E-101',
        meterType: 'ELECTRICITY',
        unitPrice: 120,
        buildingId: 'b-01',
        buildingName: '1号楼',
        roomId: 'r-101',
        roomNumber: '101',
        floor: 1,
        roomStatus: 'OCCUPIED',
        tenantId: 't-1',
        tenantName: '张三',
        tenantPhone: '13800000001',
        lastReading: 150,
        lastReadingTime: mockMeters[0].readings[0].readingTime,
        lastUsage: 50,
        prepayBalance: 8800,
      });
    });
  });

  describe('createBatchReadings', () => {
    it('批量录入：正常情况全量成功，更新读数并扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue({
        id: 'meter-001',
        meterType: 'ELECTRICITY',
        meterNumber: 'E-101',
        unitPrice: 100,
        roomId: 'r-101',
        isActive: true,
        room: { roomNumber: '101' },
      });
      prisma.meterReading.findFirst.mockResolvedValue({ currentReading: 200 });
      prisma.meterReading.create.mockResolvedValue({ id: 'rd-new', readingTime: new Date() });
      prisma.contract.findFirst.mockResolvedValue(null); // 无合同，不扣费

      const res = await service.createBatchReadings(
        { readings: [{ meterId: 'meter-001', currentReading: 260 }] },
        operatorId,
      );

      expect(res.total).toBe(1);
      expect(res.successCount).toBe(1);
      expect(res.failureCount).toBe(0);
      expect(res.results[0].success).toBe(true);
      expect(res.results[0].usage).toBe(60);
    });

    it('批量录入：行级异常处理（小于上次读数返回失败，不中断其他合法行）', async () => {
      prisma.meter.findUnique
        .mockResolvedValueOnce({
          id: 'm-err',
          meterType: 'WATER',
          meterNumber: 'W-01',
          unitPrice: 50,
          roomId: 'r-01',
          isActive: true,
          room: { roomNumber: '101' },
        })
        .mockResolvedValueOnce({
          id: 'm-ok',
          meterType: 'WATER',
          meterNumber: 'W-02',
          unitPrice: 50,
          roomId: 'r-02',
          isActive: true,
          room: { roomNumber: '102' },
        });

      prisma.meterReading.findFirst
        .mockResolvedValueOnce({ currentReading: 300 }) // m-err: 之前是 300
        .mockResolvedValueOnce({ currentReading: 100 }); // m-ok: 之前是 100

      prisma.meterReading.create.mockResolvedValue({ id: 'rd-ok', readingTime: new Date() });
      prisma.contract.findFirst.mockResolvedValue(null);

      const res = await service.createBatchReadings(
        {
          readings: [
            { meterId: 'm-err', currentReading: 250 }, // 250 < 300 失败
            { meterId: 'm-ok', currentReading: 150 },  // 150 >= 100 成功
          ],
        },
        operatorId,
      );

      expect(res.total).toBe(2);
      expect(res.successCount).toBe(1);
      expect(res.failureCount).toBe(1);
      expect(res.results[0].success).toBe(false);
      expect(res.results[0].error).toContain('不能小于上次读数');
      expect(res.results[1].success).toBe(true);
      expect(res.results[1].usage).toBe(50);
    });
  });

  describe('exportReadings', () => {
    it('正确生成包含 UTF-8 BOM 的抄表台账 CSV', async () => {
      prisma.meterReading.findMany.mockResolvedValue([
        {
          id: 'rd-1',
          previousReading: 100,
          currentReading: 160,
          usage: 60,
          readingTime: new Date('2026-10-10T10:00:00Z'),
          readBy: 'admin',
          notes: '抄表正常',
          meter: {
            meterNumber: 'E-01',
            meterType: 'ELECTRICITY',
            unitPrice: 150,
            building: { name: 'A栋' },
            room: { roomNumber: '201' },
          },
        },
      ]);

      const csv = await service.exportReadings({});

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('记录ID,表号,表类型,楼栋,房间号,上次读数,本次读数,用量,单价(元),抄表时间,抄表人,备注');
      expect(csv).toContain('E-01,电费,A栋,201,100.00,160.00,60.00,1.50');
      expect(csv).toContain('抄表正常');
    });
  });

  describe('getUsageOverview', () => {
    it('当暂无读数时，平滑回落至演示数据并标明 isDemo: true', async () => {
      prisma.meter.findMany.mockResolvedValue([
        { id: 'm-1', meterType: 'WATER', unitPrice: 420 },
        { id: 'm-2', meterType: 'ELECTRICITY', unitPrice: 90 },
      ]);
      prisma.meterReading.findMany.mockResolvedValue([]);

      const result = await service.getUsageOverview({ month: '2026-10' });

      expect(result.month).toBe('2026-10');
      expect(result.isDemo).toBe(true);
      expect(result.water.usage).toBe(32.6);
      expect(result.electricity.usage).toBe(827);
      expect(result.cost.total).toBe(13692 + 74430);
      expect(result.completion.completedMeters).toBe(28);
      expect(result.completion.totalMeters).toBe(36);
      expect(result.completion.pendingMeters).toBe(8);
      expect(result.trend).toHaveLength(6);
    });

    it('当存在读数时，准确统计用水量、用电量、成本与环比增长率', async () => {
      prisma.meter.findMany.mockResolvedValue([
        { id: 'm-w1', meterType: 'WATER', unitPrice: 400 },
        { id: 'm-e1', meterType: 'ELECTRICITY', unitPrice: 100 },
      ]);

      // 模拟当月读数
      prisma.meterReading.findMany
        .mockResolvedValueOnce([
          { meterId: 'm-w1', usage: 20, readingTime: new Date('2026-10-10') },
          { meterId: 'm-e1', usage: 500, readingTime: new Date('2026-10-10') },
        ])
        // 模拟上月读数
        .mockResolvedValueOnce([
          { meterId: 'm-w1', usage: 10 },
          { meterId: 'm-e1', usage: 400 },
        ])
        // 模拟近6个月趋势
        .mockResolvedValueOnce([
          { meterId: 'm-w1', usage: 20, readingTime: new Date('2026-10-10') },
          { meterId: 'm-e1', usage: 500, readingTime: new Date('2026-10-10') },
        ]);

      const result = await service.getUsageOverview({ month: '2026-10' });

      expect(result.isDemo).toBe(false);
      expect(result.water.usage).toBe(20);
      expect(result.water.momRate).toBe(100); // (20-10)/10 * 100 = 100%
      expect(result.electricity.usage).toBe(500);
      expect(result.electricity.momRate).toBe(25); // (500-400)/400 * 100 = 25%
      expect(result.cost.waterCost).toBe(20 * 400); // 8000
      expect(result.cost.electricityCost).toBe(500 * 100); // 50000
      expect(result.cost.total).toBe(58000);
      expect(result.completion.completedMeters).toBe(2);
      expect(result.completion.totalMeters).toBe(2);
      expect(result.completion.pendingMeters).toBe(0);
      expect(result.completion.status).toBe('DONE');
    });
  });
});
