import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('MaintenanceService', () => {
  let service: MaintenanceService;
  let prisma: any;

  const baseDto = {
    title: '卫生间漏水',
    description: '一直在滴水',
    category: 'PLUMBING',
  };

  beforeEach(async () => {
    const prismaMock: any = {
      maintenanceRequest: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        // 记录最近一次写入，供事务末尾的 findUniqueOrThrow 回读（贴近真实行为）
        create: vi.fn(async ({ data }: any) => {
          prismaMock.maintenanceRequest.__created = data;
          return { id: 'mr-auto', ...data };
        }),
        update: vi.fn(),
        delete: vi.fn(),
      },
      room: { findUnique: vi.fn() },
      tenant: { findUnique: vi.fn() },
      contract: { findFirst: vi.fn() },
      maintenancePhoto: { createMany: vi.fn() },
    };
    // create() 现为事务写入（工单 + 照片同事务）。
    // 把 prismaMock 自身作为事务客户端传入，使既有断言（prisma.maintenanceRequest.create）
    // 仍然有效，同时可断言 maintenancePhoto.createMany。
    prismaMock.$transaction = vi.fn(async (callback: any) => callback(prismaMock));
    // 事务末尾用 findUniqueOrThrow 回读（含 photos），桩按 create 落库的数据返回
    prismaMock.maintenanceRequest.findUniqueOrThrow = vi.fn(async ({ where }: any) => ({
      ...(prismaMock.maintenanceRequest.__created ?? {}),
      id: where.id,
      photos: [],
    }));
    prismaMock.maintenanceRequest.__created = undefined;

    const module: TestingModule = await Test.createTestingModule({
      providers: [MaintenanceService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<MaintenanceService>(MaintenanceService);
    prisma = prismaMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('租客自助报修：按生效合同推导 roomId/tenantId，忽略请求体中的 ID（防伪造）', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', roomId: 'room-from-contract' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-from-contract' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.maintenanceRequest.create.mockImplementation(async ({ data }: any) => {
        prisma.maintenanceRequest.__created = data;
        return { id: 'mr-1', ...data };
      });

      const result = await service.create(
        { ...baseDto, roomId: 'fake-room', tenantId: 'fake-tenant' } as any,
        { userId: 'u-1', role: 'TENANT', tenantId: 'tenant-1' },
      );

      expect(prisma.maintenanceRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ roomId: 'room-from-contract', tenantId: 'tenant-1' }),
      });
      expect(result.roomId).toBe('room-from-contract');
    });

    it('租客无生效合同：400', async () => {
      prisma.contract.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto } as any, { userId: 'u-1', role: 'TENANT', tenantId: 'tenant-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.maintenanceRequest.create).not.toHaveBeenCalled();
    });

    it('租客账号未绑定档案：400', async () => {
      await expect(
        service.create({ ...baseDto } as any, { userId: 'u-1', role: 'TENANT' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
    });

    it('管理员未指定 IDs：400', async () => {
      await expect(
        service.create({ ...baseDto } as any, { userId: 'u-1', role: 'ADMIN' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.maintenanceRequest.create).not.toHaveBeenCalled();
    });

    it('T153 带照片：工单与 MaintenancePhoto 同事务落库', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', roomId: 'room-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.maintenanceRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'mr-9', ...data }));
      prisma.maintenancePhoto.createMany.mockResolvedValue({ count: 2 });

      await service.create(
        { ...baseDto, photos: ['/api/files/a.jpg', '/api/files/b.png'] } as any,
        { userId: 'u-1', role: 'TENANT', tenantId: 'tenant-1' },
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.maintenancePhoto.createMany).toHaveBeenCalledWith({
        data: [
          { requestId: 'mr-9', fileUrl: '/api/files/a.jpg', fileSize: 0 },
          { requestId: 'mr-9', fileUrl: '/api/files/b.png', fileSize: 0 },
        ],
      });
    });

    it('T153 无照片：不写 MaintenancePhoto', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', roomId: 'room-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.maintenanceRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'mr-10', ...data }));

      await service.create(
        { ...baseDto } as any,
        { userId: 'u-1', role: 'TENANT', tenantId: 'tenant-1' },
      );

      expect(prisma.maintenancePhoto.createMany).not.toHaveBeenCalled();
    });

    it('T153 空字符串路径被过滤，不产生空照片记录', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'contract-1', roomId: 'room-1' });
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.maintenanceRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'mr-11', ...data }));

      await service.create(
        { ...baseDto, photos: ['', '   '] } as any,
        { userId: 'u-1', role: 'TENANT', tenantId: 'tenant-1' },
      );

      expect(prisma.maintenancePhoto.createMany).not.toHaveBeenCalled();
    });

    it('管理员指定 IDs：正常创建（默认优先级 NORMAL）', async () => {
      prisma.room.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
      prisma.maintenanceRequest.create.mockResolvedValue({ id: 'mr-2' });

      await service.create(
        { ...baseDto, roomId: 'room-1', tenantId: 'tenant-1' } as any,
        { userId: 'u-1', role: 'ADMIN' },
      );

      expect(prisma.maintenanceRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          roomId: 'room-1',
          tenantId: 'tenant-1',
          priority: 'NORMAL',
        }),
      });
    });

    it('房源不存在：400', async () => {
      prisma.room.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });

      await expect(
        service.create(
          { ...baseDto, roomId: 'room-x', tenantId: 'tenant-1' } as any,
          { userId: 'u-1', role: 'ADMIN' },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByTenant', () => {
    it('按租客过滤并分页倒序', async () => {
      const records = [{ id: 'mr-1' }];
      prisma.maintenanceRequest.findMany.mockResolvedValue(records);
      prisma.maintenanceRequest.count.mockResolvedValue(1);

      const result = await service.findByTenant('tenant-1', { page: 1, limit: 20 });

      expect(result.data).toEqual(records);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('状态筛选生效', async () => {
      prisma.maintenanceRequest.findMany.mockResolvedValue([]);
      prisma.maintenanceRequest.count.mockResolvedValue(0);

      await service.findByTenant('tenant-1', { status: 'SUBMITTED' as any });

      expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'SUBMITTED' },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOneForTenant', () => {
    it('非本人工单：404（不泄露存在性）', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', tenantId: 'other' });

      await expect(service.findOneForTenant('mr-1', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('本人工单：正常返回', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', tenantId: 'tenant-1' });

      const result = await service.findOneForTenant('mr-1', 'tenant-1');

      expect(result.id).toBe('mr-1');
    });
  });
});
