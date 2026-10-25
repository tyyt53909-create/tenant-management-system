import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MetersService } from './meters.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { METER_ADAPTER } from './adapters/meter-adapter.js';
import { ManualMeterAdapter } from './adapters/manual-meter.adapter.js';
import { MeterService } from './meter.service.js';
import { MeterPriceService } from './meter-price.service.js';
import { MeterReadingService } from './meter-reading.service.js';
import { MeterBatchReadingService } from './meter-batch-reading.service.js';
import { MeterBillingService } from './meter-billing.service.js';
import { MeterUsageQueryService } from './meter-usage-query.service.js';
import { testClock, testPriceService } from './meter-test.providers.js';

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
      building: { findUnique: vi.fn() },
      meter: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      meterReading: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
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
      meterPriceHistory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    prismaMock.meterPriceHistory.findMany.mockResolvedValue([]);
    prismaMock.meterPriceHistory.findFirst.mockResolvedValue(null);
    prismaMock.meterPriceHistory.create.mockImplementation(async ({ data }: any) => ({ id: 'price-1', ...data }));
    prismaMock.meterReading.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      // QLT-02 / T288：MetersService 的全部子依赖改为必填，这里用真实实现 + mock prisma 装配，
      // 断言仍然是底层 prisma 调用（与改动前一致）。
      providers: [
        MetersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BusinessClock, useValue: testClock() },
        { provide: MeterPriceService, useValue: testPriceService(prismaMock) },
        { provide: METER_ADAPTER, useValue: new ManualMeterAdapter(prismaMock as never) },
        {
          provide: MeterService,
          useFactory: (prisma: any, adapter: any, price: any) => new MeterService(prisma, adapter, price),
          inject: [PrismaService, METER_ADAPTER, MeterPriceService],
        },
        {
          provide: MeterBillingService,
          useFactory: (prisma: any) => new MeterBillingService(prisma, testClock(), testPriceService(prisma)),
          inject: [PrismaService],
        },
        {
          provide: MeterReadingService,
          useFactory: (prisma: any, billing: any, price: any) => new MeterReadingService(prisma, billing, price),
          inject: [PrismaService, MeterBillingService, MeterPriceService],
        },
        {
          provide: MeterBatchReadingService,
          useFactory: (prisma: any, billing: any, price: any) => new MeterBatchReadingService(prisma, billing, price),
          inject: [PrismaService, MeterBillingService, MeterPriceService],
        },
        {
          provide: MeterUsageQueryService,
          useFactory: (prisma: any, price: any) => new MeterUsageQueryService(prisma, testClock(), price),
          inject: [PrismaService, MeterPriceService],
        },
      ],
    }).compile();

    service = module.get<MetersService>(MetersService);
    prisma = prismaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create (initialReading)', () => {
    it('创建表时指定 initialReading，自动创建初始底数记录', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-01' });
      prisma.meter.findUnique.mockResolvedValue(null);
      prisma.meter.create.mockResolvedValue({ id: 'meter-new', meterNumber: 'M-NEW' });
      prisma.meterReading.create.mockResolvedValue({ id: 'reading-init' });

      const res = await service.create({
        buildingId: 'b-01',
        meterType: 'ELECTRICITY' as any,
        meterNumber: 'M-NEW',
        unitPrice: 100,
        priceEffectiveDate: '2026-10-01',
        initialReading: 125.5,
      });

      expect(res.id).toBe('meter-new');
      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          meterId: 'meter-new',
          currentReading: 125.5,
          previousReading: 125.5,
          usage: 0,
          notes: expect.stringContaining('[INITIAL]'),
        }),
      });
    });
  });

  describe('设置中心：类型默认价（T276）', () => {
    it('建表未传单价时使用类型默认价并写入自身价格历史', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-01' });
      prisma.meter.findUnique.mockResolvedValue(null);
      prisma.meterPriceHistory.findFirst
        .mockResolvedValueOnce({ unitPrice: 150 })
        .mockResolvedValueOnce(null);
      prisma.meter.create.mockResolvedValue({ id: 'm-default', meterNumber: 'M-D', meterType: 'ELECTRICITY', unitPrice: 150, priceEffectiveDate: new Date('2026-11-01') });

      await service.create({
        buildingId: 'b-01',
        meterType: 'ELECTRICITY' as any,
        meterNumber: 'M-D',
        priceEffectiveDate: '2026-11-01',
      });

      expect(prisma.meter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unitPrice: 150 }),
      });
      expect(prisma.meterPriceHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ meterId: 'm-default', unitPrice: 150 }),
      });
    });

    it('未传单价且类型无默认价时 400，不建表', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-01' });
      prisma.meter.findUnique.mockResolvedValue(null);
      prisma.meterPriceHistory.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          buildingId: 'b-01',
          meterType: 'WATER' as any,
          meterNumber: 'M-NO-PRICE',
          priceEffectiveDate: '2026-11-01',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.meter.create).not.toHaveBeenCalled();
    });

    it('listTypeDefaults 返回三个表类型的当前默认价', async () => {
      prisma.meterPriceHistory.findMany.mockResolvedValue([
        { meterType: 'WATER', unitPrice: 420, effectiveDate: new Date('2026-10-01') },
      ]);

      const rows = await service.listTypeDefaults();

      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.meterType === 'WATER')).toMatchObject({ unitPrice: 420 });
      expect(rows.find((row) => row.meterType === 'ELECTRICITY')).toMatchObject({ unitPrice: null });
    });

    it('setTypeDefault 写入 meterId=null 的价格并记 before/after 审计', async () => {
      prisma.meterPriceHistory.findFirst
        .mockResolvedValueOnce({ unitPrice: 100 })
        .mockResolvedValueOnce(null);
      prisma.meterPriceHistory.create.mockResolvedValue({ id: 'p-new', unitPrice: 120 });

      const result = await service.setTypeDefault(
        { meterType: 'ELECTRICITY' as any, unitPrice: 120, effectiveDate: '2026-11-01' },
        { userId: 'admin-1', ip: '127.0.0.1', userAgent: 'vitest' },
      );

      expect(result).toMatchObject({ unitPrice: 120 });
      expect(prisma.meterPriceHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ meterId: null, meterType: 'ELECTRICITY', unitPrice: 120 }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'UPDATE_METER_DEFAULT_PRICE' }),
      });
    });
  });

  describe('createReading', () => {
    it('首次读数：无历史记录时自动作为初始底数登记，不计算用量与扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue(null);
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-1',
        ...data,
      }));

      const result = await service.createReading(
        meterId,
        { currentReading: 200 } as any,
        operatorId,
      );

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousReading: 200,
          currentReading: 200,
          usage: 0,
          source: 'MANUAL',
          notes: expect.stringContaining('[INITIAL]'),
        }),
      });
      expect(prisma.prepayAccount.updateMany).not.toHaveBeenCalled();
      expect(prisma.bill.create).not.toHaveBeenCalled();
      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('初始底数');
    });

    it('显式声明 isInitial: true，作为初始底数登记，不计费用', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 150 });
      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-init',
        ...data,
      }));

      const result = await service.createReading(
        meterId,
        { currentReading: 300, isInitial: true } as any,
        operatorId,
      );

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousReading: 300,
          currentReading: 300,
          usage: 0,
          notes: expect.stringContaining('[INITIAL]'),
        }),
      });
      expect(prisma.prepayAccount.updateMany).not.toHaveBeenCalled();
      expect(result.deduction.applied).toBe(false);
    });

    it('非首次读数：usage = 本次 - 上次，余额充足全额扣费', async () => {
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

      const result = await service.createReading(meterId, { currentReading: 200 } as any, operatorId);

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ previousReading: 150, currentReading: 200, usage: 50 }),
      });
      expect(prisma.prepayAccount.updateMany).toHaveBeenCalledWith({
        where: { id: 'account-1', balanceCache: { gte: 5000 } },
        data: { balanceCache: { decrement: 5000 } },
      });
      expect(result.deduction.applied).toBe(true);
      expect(result.deduction.shortfall).toBe(0);
    });

    it('余额不足：扣尽余额 + 差额生成 UTILITY 补缴账单', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 0 });
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
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 0 });
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
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 50 });
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
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 50 });
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
      prisma.meterReading.findFirst.mockResolvedValue({ id: 'reading-0', currentReading: 50 });
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

    it('去重防护：相同 messageId 重复上传时返回已存在记录且不重复扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      const existingReading = { id: 'msg-exist', currentReading: 180, notes: '[msgId:iot-pkg-999]' };
      prisma.meterReading.findFirst.mockResolvedValue(existingReading);

      const result = await service.createReading(
        meterId,
        { currentReading: 180, messageId: 'iot-pkg-999' } as any,
        operatorId,
      );

      expect(result.reading).toEqual(existingReading);
      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('messageId 已存在');
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('防重保护：相同 (readingTime, currentReading) 重复到达时返回已有记录', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      const duplicateRecord = { id: 'dup-1', currentReading: 180, readingTime: new Date('2026-10-15T12:00:00Z') };
      // 第一次 findFirst 是 messageId (无), 第二次 findFirst 是时间读数防重
      prisma.meterReading.findFirst.mockResolvedValueOnce(duplicateRecord);

      const result = await service.createReading(
        meterId,
        { currentReading: 180, readingTime: '2026-10-15T12:00:00Z' } as any,
        operatorId,
      );

      expect(result.reading).toEqual(duplicateRecord);
      expect(result.deduction.applied).toBe(false);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('乱序延迟到达：时间早于最新记录且读数合法时，记录入库打标 [OUT_OF_ORDER]，不触发即时扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      const latestRecord = { id: 'latest', currentReading: 200, readingTime: new Date('2026-10-15T14:00:00Z') };
      const precedingRecord = { id: 'preceding', currentReading: 150, readingTime: new Date('2026-10-15T10:00:00Z') };

      // 1: 防重 (null)
      // 2: latest (14:00, 200)
      // 3: 检查后续是否有矛盾 (null)
      // 4: 查找前面最近记录 preceding (10:00, 150)
      prisma.meterReading.findFirst
        .mockResolvedValueOnce(latestRecord)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(precedingRecord);

      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'out-of-order-reading',
        ...data,
      }));

      const result = await service.createReading(
        meterId,
        { currentReading: 170, readingTime: '2026-10-15T12:00:00Z' } as any,
        operatorId,
      );

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          previousReading: 150,
          currentReading: 170,
          usage: 20,
          notes: expect.stringContaining('[OUT_OF_ORDER]'),
        }),
      });
      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('延迟乱序数据已入库归档');
      expect(prisma.prepayAccount.updateMany).not.toHaveBeenCalled();
    });

    it('乱序矛盾异常：早于后续记录的时间点读数却高于后续读数，抛出 400 异常', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      const latestRecord = { id: 'latest', currentReading: 200, readingTime: new Date('2026-10-15T14:00:00Z') };
      const contradictoryRecord = { id: 'later-smaller', currentReading: 160, readingTime: new Date('2026-10-15T13:00:00Z') };

      prisma.meterReading.findFirst
        .mockResolvedValueOnce(latestRecord)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(contradictoryRecord);

      await expect(
        service.createReading(
          meterId,
          { currentReading: 180, readingTime: '2026-10-15T12:00:00Z' } as any,
          operatorId,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.meterReading.create).not.toHaveBeenCalled();
    });

    it('采集与结算拆分：autoSettle=false 仅采集读数，不扣费', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue({
        id: 'prev',
        currentReading: 100,
        readingTime: new Date(Date.now() - 3600000),
      });

      prisma.meterReading.create.mockImplementation(async ({ data }: any) => ({
        id: 'reading-nosettle',
        ...data,
      }));

      const result = await service.createReading(
        meterId,
        { currentReading: 150, autoSettle: false } as any,
        operatorId,
      );

      expect(prisma.meterReading.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ previousReading: 100, currentReading: 150, usage: 50 }),
      });
      expect(prisma.prepayAccount.updateMany).not.toHaveBeenCalled();
      expect(result.deduction.applied).toBe(false);
      expect(result.deduction.reason).toContain('未开启自动扣费');
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
    it('当暂无读数时返回真实零值与 hasData: false，不再回落演示数据', async () => {
      prisma.meter.findMany.mockResolvedValue([
        { id: 'm-1', meterType: 'WATER', unitPrice: 420 },
        { id: 'm-2', meterType: 'ELECTRICITY', unitPrice: 90 },
      ]);
      prisma.meterReading.findMany.mockResolvedValue([]);

      const result = await service.getUsageOverview({ month: '2026-10' });

      expect(result.month).toBe('2026-10');
      expect(result.hasData).toBe(false);
      expect(result.water.usage).toBe(0);
      expect(result.electricity.usage).toBe(0);
      expect(result.cost.total).toBe(0);
      expect(result.completion.completedMeters).toBe(0);
      expect(result.completion.totalMeters).toBe(2);
      expect(result.completion.pendingMeters).toBe(2);
      expect(result.trend).toHaveLength(6);
      expect(result.trend.every((item) => item.waterUsage === 0 && item.electricityUsage === 0)).toBe(true);
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

      expect(result.hasData).toBe(true);
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
      expect(prisma.meterReading.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ source: { not: 'SIMULATED' } }),
        }),
      );
    });
  });

  describe('settleMeter', () => {
    it('表不存在：404', async () => {
      prisma.meter.findUnique.mockResolvedValue(null);
      await expect(service.settleMeter('m-no', {}, operatorId)).rejects.toThrow(NotFoundException);
    });

    it('无读数记录：400，且不把模拟读数当作可结算读数', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      prisma.meterReading.findFirst.mockResolvedValue(null);
      await expect(service.settleMeter(meterId, {}, operatorId)).rejects.toThrow(BadRequestException);
      expect(prisma.meterReading.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ source: { not: 'SIMULATED' } }),
        }),
      );
    });

    it('已结算读数无新增用量：settled=false, usage=0', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      const latestReading = { id: 'rd-latest', currentReading: 200, readingTime: new Date(), settledAt: new Date() };
      prisma.meterReading.findFirst
        .mockResolvedValueOnce(latestReading)
        .mockResolvedValueOnce(latestReading);

      const result = await service.settleMeter(meterId, {}, operatorId);
      expect(result.settled).toBe(false);
      expect(result.usage).toBe(0);
      expect(result.reason).toContain('已结算');
    });

    it('结算周期内累计用量并完成扣费，打标 [SETTLED]', async () => {
      prisma.meter.findUnique.mockResolvedValue(baseMeter);
      const latestReading = { id: 'rd-latest', currentReading: 250, readingTime: new Date(), notes: '日常采集' };
      const lastSettledReading = { id: 'rd-base', currentReading: 150, readingTime: new Date('2026-10-01'), settledAt: new Date('2026-10-01') };

      prisma.meterReading.findFirst
        .mockResolvedValueOnce(latestReading)
        .mockResolvedValueOnce(lastSettledReading);

      prisma.contract.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 't-1' });
      prisma.prepayAccount.findUnique.mockResolvedValue({ id: 'acc-1', balanceCache: 20000 });
      prisma.prepayAccount.updateMany.mockResolvedValue({ count: 1 });
      prisma.prepayAccount.findUniqueOrThrow.mockResolvedValue({ balanceCache: 10000 });
      prisma.prepayTransaction.create.mockResolvedValue({ id: 'tx-settle' });
      prisma.meterReading.update.mockResolvedValue({ id: 'rd-latest' });

      const result = await service.settleMeter(meterId, { notes: '10月结账' }, operatorId);

      expect(result.settled).toBe(true);
      expect(result.usage).toBe(100); // 250 - 150
      expect(result.amount).toBe(10000); // 100 * 100
      expect(prisma.meterReading.update).toHaveBeenCalledWith({
        where: { id: 'rd-latest' },
        data: expect.objectContaining({ notes: expect.stringContaining('[SETTLED]') }),
      });
      expect((result as any).deduction.applied).toBe(true);
      expect((result as any).deduction.deducted).toBe(10000);
    });
  });

  describe('getUnsettledUsage', () => {
    it('准确预估未结算用量及扣费金额', async () => {
      prisma.meter.findUnique.mockResolvedValue({
        ...baseMeter,
        room: {
          contracts: [{ tenantId: 't-1', tenant: { name: '李四' } }],
        },
      });
      const latestReading = { id: 'rd-latest', currentReading: 320, readingTime: new Date('2026-10-15T10:00:00Z') };
      const lastSettled = { id: 'rd-settled', currentReading: 200, readingTime: new Date('2026-10-01T00:00:00Z'), settledAt: new Date('2026-10-01T00:00:00Z') };

      prisma.meterReading.findFirst
        .mockResolvedValueOnce(latestReading)
        .mockResolvedValueOnce(lastSettled);

      prisma.prepayAccount.findUnique.mockResolvedValue({ balanceCache: 15000 });

      const result = await service.getUnsettledUsage(meterId);

      expect(result.unsettledUsage).toBe(120); // 320 - 200
      expect(result.estimatedAmount).toBe(12000); // 120 * 100
      expect(result.prepayBalance).toBe(15000);
      expect(result.lastSettledReading).toBe(200);
      expect(result.currentReading).toBe(320);
    });
  });

  describe('settleBatch', () => {
    it('按列表批量结算，汇总成功和失败结果', async () => {
      vi.spyOn(service, 'settleMeter')
        .mockResolvedValueOnce({ settled: true, usage: 50, amount: 5000 } as any)
        .mockRejectedValueOnce(new BadRequestException('无读数记录'));

      const res = await service.settleBatch({ meterIds: ['m-1', 'm-2'] }, operatorId);

      expect(res.total).toBe(2);
      expect(res.successCount).toBe(1);
      expect(res.failureCount).toBe(1);
      expect(res.results[0].success).toBe(true);
      expect(res.results[1].success).toBe(false);
      expect(res.results[1].error).toContain('无读数记录');
    });
  });
});
