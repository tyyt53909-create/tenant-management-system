import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

    it('租客账号未绑定档案（tenantId 缺失）→ 403，且不查库', async () => {
      await expect(service.findOneForTenant(recordId, undefined)).rejects.toThrow(ForbiddenException);
      expect(prisma.checkoutRecord.findUnique).not.toHaveBeenCalled();
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
    it('财务凭证禁止硬删除 → 409', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({ id: recordId });

      await expect(service.remove(recordId)).rejects.toThrow(ConflictException);
      expect(prisma.checkoutRecord.delete).not.toHaveBeenCalled();
    });

    it('不存在 → 404', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue(null);

      await expect(service.remove(recordId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('exportCheckouts', () => {
    it('正确生成包含 UTF-8 BOM 的退租记录 CSV', async () => {
      prisma.checkoutRecord.findMany.mockResolvedValue([
        {
          id: 'chk-1',
          checkoutDate: new Date('2026-10-12'),
          totalRefund: 180000,
          processedBy: 'admin',
          status: 'COMPLETED',
          createdAt: new Date('2026-10-12'),
          contractId: 'contract-1',
          notes: '顺利退租',
          room: { roomNumber: '202' },
          contract: { tenant: { name: '赵六', phone: '13600000004' } },
          items: [{ id: 'item-1' }, { id: 'item-2' }],
        },
      ]);

      const csv = await service.exportCheckouts({});

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('退租记录ID,房间号,租客姓名,租客电话,合同ID,退租日期,明细项数,实退总额(元),经办人,状态,创建时间,备注');
      expect(csv).toContain('chk-1,202,赵六,13600000004,contract-1,2026-10-12,2,1800.00,admin,已完成');
      // 创建时间按业务时区（Asia/Shanghai）输出，不随进程 TZ 变化
      expect(csv).toContain('2026-10-12 08:00:00');
    });
  });

  describe('getVoucher', () => {
    it('不存在 → 404', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue(null);
      await expect(service.getVoucher('not-found')).rejects.toThrow(NotFoundException);
    });

    it('返回完整退租结算凭单，包含扣款与退款汇总及中文大写净额', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: 'chk-1',
        checkoutDate: new Date('2026-10-12'),
        totalRefund: 180000,
        status: 'COMPLETED',
        processedBy: 'admin-1',
        notes: '无物品遗留',
        room: { roomNumber: '202', building: { name: '天河公寓' } },
        contract: {
          id: 'contract-1',
          startDate: new Date('2025-10-12'),
          endDate: new Date('2026-10-11'),
          depositAmount: 200000,
          tenant: { name: '赵六', phone: '13600000004' },
        },
        items: [
          {
            id: 'it-1',
            // T207：原先用不存在的 'CLEANING_FEE'（数据库里不可能出现），
            // 恰好命中服务里同样错误的过滤清单，于是掩盖了 totalDeduction 恒为 0 的缺陷
            itemType: 'OTHER_FEE',
            description: '深度保洁费',
            amount: 20000,
            isAdjusted: false,
            adjustReason: null,
          },
        ],
      });

      const voucher = await service.getVoucher('chk-1');

      expect(voucher.voucherNumber).toBe('VCH-CHK-1');
      expect(voucher.tenantName).toBe('赵六');
      expect(voucher.roomNumber).toBe('202');
      expect(voucher.buildingName).toBe('天河公寓');
      expect(voucher.depositAmount).toBe(200000);
      expect(voucher.totalDeduction).toBe(20000);
      expect(voucher.netRefund).toBe(180000);
      expect(voucher.netRefundInChinese).toBe('壹仟捌佰元整');
      expect(voucher.items).toHaveLength(1);
      expect(voucher.items[0].amountYuan).toBe('200.00');
    });

    it('租客无档案（tenantId 为空串）→ 404，不再 fail-open 返回他人结算单（T209）', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: 'chk-x',
        status: 'COMPLETED',
        contract: { tenantId: 'tenant-real', tenant: { name: '别人' } },
        items: [],
      });

      await expect(service.getVoucher('chk-x', '')).rejects.toThrow(NotFoundException);
    });

    it('totalRefund 为空时按明细重算：押金扣除与水电余额退还都计入（回归 T207）', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: 'chk-2',
        checkoutDate: new Date('2026-10-12'),
        totalRefund: null,
        status: 'PENDING',
        processedBy: 'admin-1',
        notes: null,
        room: { roomNumber: '303', building: { name: '天河公寓' } },
        contract: {
          id: 'contract-2',
          startDate: new Date('2025-08-01'),
          endDate: new Date('2026-07-31'),
          depositAmount: 300000,
          tenant: { name: '钱七', phone: '13600000005' },
        },
        items: [
          {
            id: 'it-a',
            itemType: 'DEPOSIT_DEDUCTION',
            description: '墙面破损',
            amount: 50000,
            isAdjusted: false,
            adjustReason: null,
          },
          {
            id: 'it-b',
            itemType: 'UTILITY_REFUND',
            description: '水电预付余额退还',
            amount: 12000,
            isAdjusted: false,
            adjustReason: null,
          },
          {
            id: 'it-c',
            itemType: 'RENT_REFUND',
            description: '剩余租金',
            amount: 8000,
            isAdjusted: false,
            adjustReason: null,
          },
        ],
      });

      const voucher = await service.getVoucher('chk-2');

      // 扣款 50000 必须被算进去（修复前恒为 0），退款侧要含 UTILITY_REFUND（12000 + 8000）
      expect(voucher.totalDeduction).toBe(50000);
      expect(voucher.netRefund).toBe(300000 + 20000 - 50000);
    });

    it('租客越权读取他人退租凭单抛出 NotFoundException', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: 'chk-1',
        contract: { tenantId: 'tenant-real' },
      });

      await expect(service.getVoucher('chk-1', 'tenant-attacker')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('租客读取自己退租凭单正常放行', async () => {
      prisma.checkoutRecord.findUnique.mockResolvedValue({
        id: 'chk-1',
        status: 'COMPLETED',
        contractId: 'c-1',
        contract: {
          tenantId: 'tenant-real',
          depositAmount: 100000,
          tenant: { name: '李四', phone: '13900000000' },
        },
        room: { roomNumber: '102', building: { name: 'B栋' } },
        items: [],
      });

      const voucher = await service.getVoucher('chk-1', 'tenant-real');
      expect(voucher.tenantName).toBe('李四');
      expect(voucher.roomNumber).toBe('102');
    });
  });
});
