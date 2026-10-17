import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ContractsService } from './contracts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * 合同 CRUD 覆盖（T157）：此前仅有租客隔离与续签测试，
 * create/update/remove/findAll/findOne 完全未覆盖（service 语句覆盖率 35.8%）。
 */
describe('ContractsService CRUD（T157）', () => {
  let service: ContractsService;
  let prisma: any;

  const baseDto = {
    buildingId: 'b-1',
    roomId: 'room-1',
    tenantId: 'tenant-1',
    rentAmount: 300000,
    depositAmount: 600000,
    paymentCycle: 'MONTHLY',
    paymentDay: 5,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  };

  beforeEach(async () => {
    const prismaMock: any = {
      contract: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null), // T207：create 会检查同房源是否已有未结束合同
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      building: { findUnique: vi.fn() },
      room: { findUnique: vi.fn(), update: vi.fn() },
      tenant: { findUnique: vi.fn() },
    };
    // update() 现在把状态流转与房间随动放进事务里
    prismaMock.$transaction = vi.fn(async (callback: any) => callback(prismaMock));

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContractsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
    prisma = prismaMock;
  });

  describe('create', () => {
    it('关联数据齐备 → 生成合同编号并落库（lateFeeRule 缺省为 {}）', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.contract.create.mockImplementation(async ({ data }: any) => ({ id: 'c-new', ...data }));

      const res = await service.create(baseDto as any);

      const data = prisma.contract.create.mock.calls[0][0].data;
      expect(data.buildingId).toBe('b-1');
      expect(data.roomId).toBe('room-1');
      expect(data.tenantId).toBe('tenant-1');
      expect(data.rentAmount).toBe(300000);
      expect(data.depositAmount).toBe(600000);
      expect(data.contractNumber).toMatch(/^C\d+/);
      expect(data.lateFeeRule).toEqual({});
      expect(data.startDate).toBeInstanceOf(Date);
      expect(res.id).toBe('c-new');
    });

    it('传入 lateFeeRule 时原样落库', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.contract.create.mockImplementation(async ({ data }: any) => data);

      await service.create({ ...baseDto, lateFeeRule: { graceDays: 3, cap: 50000 } } as any);

      expect(prisma.contract.create.mock.calls[0][0].data.lateFeeRule).toEqual({
        graceDays: 3,
        cap: 50000,
      });
    });

    it('楼栋不存在 → 400 且不落库', async () => {
      prisma.building.findUnique.mockResolvedValue(null);
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      await expect(service.create(baseDto as any)).rejects.toThrow(BadRequestException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('房源不存在 → 400', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      await expect(service.create(baseDto as any)).rejects.toThrow(BadRequestException);
    });

    it('租客不存在 → 400', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('支持 status/tenantId/roomId/buildingId 过滤与分页', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      const res = await service.findAll({
        page: 2,
        limit: 10,
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        roomId: 'room-1',
        buildingId: 'b-1',
      } as any);

      const args = prisma.contract.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        status: 'ACTIVE',
        tenantId: 'tenant-1',
        roomId: 'room-1',
        buildingId: 'b-1',
      });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(res.meta).toEqual({ page: 2, limit: 10, total: 0, totalPages: 0 });
    });

    it('无条件时不加 where 过滤', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      prisma.contract.count.mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20 } as any);

      expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual({});
    });
  });

  describe('findOne', () => {
    it('存在 → 返回（含房源、租客与续签链）', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'DRAFT', roomId: 'room-1' });

      const res = await service.findOne('c-1');

      expect(res.id).toBe('c-1');
      const args = prisma.contract.findUnique.mock.calls[0][0];
      expect(args.include).toBeDefined();
    });

    it('不存在 → 404', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('仅更新传入字段（未传字段不出现在 data 中）', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'DRAFT', roomId: 'room-1' });
      prisma.contract.update.mockResolvedValue({ id: 'c-1' });

      await service.update('c-1', { rentAmount: 350000, status: 'ACTIVE' } as any);

      const data = prisma.contract.update.mock.calls[0][0].data;
      expect(data.rentAmount).toBe(350000);
      expect(data.status).toBe('ACTIVE');
      expect(data.depositAmount).toBeUndefined();
      expect(data.paymentCycle).toBeUndefined();
      expect(data.startDate).toBeUndefined();
    });

    it('日期字段转为 Date', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'DRAFT', roomId: 'room-1' });
      prisma.contract.update.mockResolvedValue({ id: 'c-1' });

      await service.update('c-1', { startDate: '2027-01-01' } as any);

      expect(prisma.contract.update.mock.calls[0][0].data.startDate).toBeInstanceOf(Date);
    });

    it('不存在 → 404 且不更新', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { rentAmount: 1 } as any)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.contract.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('存在 → 删除并返回提示', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'DRAFT', roomId: 'room-1' });
      prisma.contract.delete.mockResolvedValue({ id: 'c-1' });

      const res = await service.remove('c-1');

      expect(prisma.contract.delete).toHaveBeenCalledWith({ where: { id: 'c-1' } });
      expect(res).toEqual({ message: '合同已删除' });
    });

    it('不存在 → 404 且不删除', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
      expect(prisma.contract.delete).not.toHaveBeenCalled();
    });
  });

  describe('状态机与资料完整性（T207）', () => {
    it('create：同房源已有未结束合同 → 409（避免同一房间重复出账）', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.contract.findFirst.mockResolvedValue({ contractNumber: 'C2026-X', status: 'ACTIVE' });

      await expect(service.create(baseDto as any)).rejects.toThrow(ConflictException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('create：结束日期早于开始日期 → 400（renew 一直有这条校验，create 之前漏了）', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'b-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      await expect(
        service.create({ ...baseDto, startDate: '2026-12-01', endDate: '2026-11-01' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });

    it('update：终态不可逆（TERMINATED → ACTIVE 被挡）', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-9', status: 'TERMINATED', roomId: 'room-1' });

      await expect(service.update('c-9', { status: 'ACTIVE' } as any)).rejects.toThrow(ConflictException);
      expect(prisma.contract.update).not.toHaveBeenCalled();
    });

    it('update：DRAFT → ACTIVE 且房间为 RESERVED 时，房间随动为 OCCUPIED', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'DRAFT', roomId: 'room-1' });
      prisma.contract.update.mockResolvedValue({ id: 'c-1' });
      prisma.room.findUnique.mockResolvedValue({ status: 'RESERVED' });

      await service.update('c-1', { status: 'ACTIVE' } as any);

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'OCCUPIED', version: { increment: 1 } },
      });
    });

    it('update：ACTIVE → TERMINATED 且房间为 OCCUPIED 时，房间变为 VACANT + PENDING_CLEAN', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'ACTIVE', roomId: 'room-1' });
      prisma.contract.update.mockResolvedValue({ id: 'c-1' });
      prisma.room.findUnique.mockResolvedValue({ status: 'OCCUPIED' });

      await service.update('c-1', { status: 'TERMINATED' } as any);

      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'VACANT', cleanStatus: 'PENDING_CLEAN', version: { increment: 1 } },
      });
    });

    it('update：房态前置条件不满足时不强改房间', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'DRAFT', roomId: 'room-1' });
      prisma.contract.update.mockResolvedValue({ id: 'c-1' });
      prisma.room.findUnique.mockResolvedValue({ status: 'MAINTENANCE' });

      await service.update('c-1', { status: 'ACTIVE' } as any);

      expect(prisma.contract.update).toHaveBeenCalled();
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it('update：不传 status 时不做流转校验，也不碰房间', async () => {
      prisma.contract.findUnique.mockResolvedValue({ id: 'c-1', status: 'TERMINATED', roomId: 'room-1' });
      prisma.contract.update.mockResolvedValue({ id: 'c-1' });

      await service.update('c-1', { rentAmount: 111 } as any);

      expect(prisma.room.findUnique).not.toHaveBeenCalled();
      expect(prisma.room.update).not.toHaveBeenCalled();
    });
  });
});
