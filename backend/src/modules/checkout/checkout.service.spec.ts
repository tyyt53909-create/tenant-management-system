import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CheckoutService } from './checkout.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('CheckoutService', () => {
  let service: CheckoutService;
  let prisma: any;

  const recordId = 'checkout-1';

  beforeEach(async () => {
    const prismaMock: any = {
      checkoutRecord: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      checkoutItem: { createMany: vi.fn(), deleteMany: vi.fn() },
      contract: { findUnique: vi.fn() },
      room: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    // 事务末尾回读主记录（含 items）
    prismaMock.checkoutRecord.findUniqueOrThrow = vi.fn(async ({ where }: any) => ({
      id: where.id,
      items: [],
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [CheckoutService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
    prisma = prismaMock;
  });

  describe('create', () => {
    const dto = {
      contractId: 'contract-1',
      roomId: 'room-1',
      checkoutDate: '2026-10-13',
      totalRefund: 100000,
      processedBy: 'admin-1',
      notes: '正常退租',
    } as any;

    it('合同与房源存在 → 事务内创建退租记录（无明细时不写明细）', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'contract-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.checkoutRecord.create.mockResolvedValue({ id: recordId });
      prisma.checkoutRecord.findUniqueOrThrow.mockResolvedValue({ id: recordId, items: [] });

      const result = await service.create(dto);

      expect(result.id).toBe(recordId);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.checkoutRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contractId: 'contract-1',
          roomId: 'room-1',
          checkoutDate: expect.any(Date),
          totalRefund: 100000,
        }),
      });
      expect(prisma.checkoutItem.createMany).not.toHaveBeenCalled();
      expect(prisma.checkoutRecord.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: recordId },
        include: { items: true },
      });
    });

    it('带结算明细 → 主记录与明细在同一事务内落库（押金扣除项含类别/金额/说明）', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'contract-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.checkoutRecord.create.mockResolvedValue({ id: recordId });
      prisma.checkoutItem.createMany.mockResolvedValue({ count: 3 });
      const items = [
        { itemType: 'DEPOSIT_DEDUCTION', description: '墙面破损', amount: 80000, calculation: { days: 2 } },
        { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 120000, isAdjusted: true, adjustReason: '协商一致' },
        { itemType: 'RENT_REFUND', description: '剩余租金', amount: 50000 },
      ];
      prisma.checkoutRecord.findUniqueOrThrow.mockResolvedValue({ id: recordId, items });

      const result = await service.create({ ...dto, items } as any);

      expect(prisma.checkoutItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            checkoutId: recordId,
            itemType: 'DEPOSIT_DEDUCTION',
            description: '墙面破损',
            amount: 80000,
            calculation: { days: 2 },
            isAdjusted: false,
          }),
          expect.objectContaining({
            checkoutId: recordId,
            itemType: 'DEPOSIT_REFUND',
            amount: 120000,
            isAdjusted: true,
            adjustReason: '协商一致',
          }),
          expect.objectContaining({
            checkoutId: recordId,
            itemType: 'RENT_REFUND',
            amount: 50000,
          }),
        ],
      });
      expect(result.items).toHaveLength(3);
    });

    it('合同不存在 → BadRequestException，不开启事务', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.checkoutRecord.create).not.toHaveBeenCalled();
      expect(prisma.checkoutItem.createMany).not.toHaveBeenCalled();
    });

    it('房源不存在 → BadRequestException', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'contract-1' });
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('支持 status / contractId 过滤并分页', async () => {
      prisma.checkoutRecord.findMany.mockResolvedValue([]);
      prisma.checkoutRecord.count.mockResolvedValue(0);

      const result = await service.findAll({ page: 2, limit: 10, status: 'COMPLETED' } as any);

      expect(result.meta).toEqual({ page: 2, limit: 10, total: 0, totalPages: 0 });
      expect(prisma.checkoutRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'COMPLETED' },
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('存在 → 返回记录', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({ id: recordId });

      await expect(service.findOne(recordId)).resolves.toEqual({ id: recordId });
    });

    it('不存在 → 404', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue(null);

      await expect(service.findOne(recordId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByTenant（T148 租客隔离）', () => {
    it('服务端固定按 contract.tenantId 过滤，忽略查询参数中的 contractId', async () => {
      prisma.checkoutRecord.findMany.mockResolvedValue([]);
      prisma.checkoutRecord.count.mockResolvedValue(0);

      await service.findByTenant('tenant-1', {
        page: 1,
        limit: 20,
        contractId: 'contract-other',
      } as any);

      expect(prisma.checkoutRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { contract: { tenantId: 'tenant-1' } } }),
      );
    });
  });

  describe('findOneForTenant（T148 租客隔离）', () => {
    it('自己的记录 → 返回', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: recordId,
        contract: { tenantId: 'tenant-1' },
      });

      const result = await service.findOneForTenant(recordId, 'tenant-1');

      expect(result.id).toBe(recordId);
    });

    it('他人记录 → 404（不暴露存在性）', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: recordId,
        contract: { tenantId: 'tenant-2' },
      });

      await expect(service.findOneForTenant(recordId, 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('记录不存在 → 404', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue(null);

      await expect(service.findOneForTenant(recordId, 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('租客账号未绑定档案（tenantId 缺失）→ 404', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: recordId,
        contract: { tenantId: 'tenant-1' },
      });

      await expect(service.findOneForTenant(recordId, undefined)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('状态置为 COMPLETED → 写入 processedAt', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({ id: recordId });
      prisma.checkoutRecord.update.mockResolvedValue({ id: recordId, status: 'COMPLETED' });

      await service.update(recordId, { status: 'COMPLETED' } as any);

      expect(prisma.checkoutRecord.update).toHaveBeenCalledWith({
        where: { id: recordId },
        data: expect.objectContaining({ status: 'COMPLETED', processedAt: expect.any(Date) }),
      });
    });

    it('不存在 → 404', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue(null);

      await expect(service.update(recordId, {} as any)).rejects.toThrow(NotFoundException);
    });

    it('提供 items → 同事务内全量替换明细（先删后建）', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({ id: recordId });
      prisma.checkoutRecord.update.mockResolvedValue({ id: recordId });
      prisma.checkoutItem.deleteMany.mockResolvedValue({ count: 1 });
      prisma.checkoutItem.createMany.mockResolvedValue({ count: 2 });

      await service.update(recordId, {
        items: [
          { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 500000 },
          { itemType: 'DEPOSIT_DEDUCTION', description: '墙面修补', amount: 30050 },
        ],
      } as any);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.checkoutItem.deleteMany).toHaveBeenCalledWith({ where: { checkoutId: recordId } });
      expect(prisma.checkoutItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ checkoutId: recordId, itemType: 'DEPOSIT_REFUND', amount: 500000 }),
          expect.objectContaining({ checkoutId: recordId, itemType: 'DEPOSIT_DEDUCTION', amount: 30050 }),
        ],
      });
    });

    it('未提供 items → 不触碰明细表', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({ id: recordId });
      prisma.checkoutRecord.update.mockResolvedValue({ id: recordId });

      await service.update(recordId, { notes: '仅备注' } as any);

      expect(prisma.checkoutItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.checkoutItem.createMany).not.toHaveBeenCalled();
    });

    it('提供空数组 → 清空全部明细', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({ id: recordId });
      prisma.checkoutRecord.update.mockResolvedValue({ id: recordId });
      prisma.checkoutItem.deleteMany.mockResolvedValue({ count: 3 });

      await service.update(recordId, { items: [] } as any);

      expect(prisma.checkoutItem.deleteMany).toHaveBeenCalledWith({ where: { checkoutId: recordId } });
      expect(prisma.checkoutItem.createMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('存在 → 删除', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({ id: recordId });
      prisma.checkoutRecord.delete.mockResolvedValue({ id: recordId });

      await expect(service.remove(recordId)).resolves.toEqual({ message: '退租记录已删除' });
    });

    it('不存在 → 404', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue(null);

      await expect(service.remove(recordId)).rejects.toThrow(NotFoundException);
    });
  });
});
