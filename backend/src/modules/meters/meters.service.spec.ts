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
});
