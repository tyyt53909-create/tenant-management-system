import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
      maintenanceMessage: {
        create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
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

  describe('findAll', () => {
    it('管理列表提供首张照片及真实照片数，不加载全部原图记录', async () => {
      prisma.maintenanceRequest.findMany.mockResolvedValue([{id:'mr-1',photos:[{id:'p1',fileUrl:'/api/files/a.png'}],_count:{photos:9}}]);
      prisma.maintenanceRequest.count.mockResolvedValue(1);
      const result=await service.findAll({});
      expect(prisma.maintenanceRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({include:expect.objectContaining({
        photos:{select:{id:true,fileUrl:true},orderBy:{createdAt:'asc'},take:1},_count:{select:{photos:true}},
      })}));
      expect(result.data[0]._count.photos).toBe(9);
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
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', tenantId: 'tenant-1', photos:[{id:'photo-1',fileUrl:'/api/files/photo.png'}] });

      const result = await service.findOneForTenant('mr-1', 'tenant-1');

      expect(result.id).toBe('mr-1');
      expect(prisma.maintenanceRequest.findUnique).toHaveBeenCalledWith({where:{id:'mr-1'},include:{photos:true}});
      expect(result.photos).toHaveLength(1);
    });
  });

  describe('状态流转与字段副作用（T207）', () => {
    it('终态不可逆：COMPLETED → SUBMITTED 被拒，且不写库', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', status: 'COMPLETED' });

      await expect(service.update('mr-1', { status: 'SUBMITTED' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.maintenanceRequest.update).not.toHaveBeenCalled();
    });

    it('跨状态跳跃被拒：SUBMITTED → ASSIGNED', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', status: 'SUBMITTED' });

      await expect(
        service.update('mr-1', { status: 'ASSIGNED', assignedTo: 'cleaner-1' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('派单必须指定 assignedTo（也不能沿用空的旧值）', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({
        id: 'mr-1',
        status: 'ACKNOWLEDGED',
        assignedTo: null,
      });

      await expect(service.update('mr-1', { status: 'ASSIGNED' } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ACKNOWLEDGED → ASSIGNED 带 assignedTo 时写入 assignedTo 与 assignedAt', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({
        id: 'mr-1',
        status: 'ACKNOWLEDGED',
        assignedTo: null,
      });
      prisma.maintenanceRequest.update.mockResolvedValue({ id: 'mr-1' });

      await service.update('mr-1', { status: 'ASSIGNED', assignedTo: 'cleaner-1' } as any);

      const data = prisma.maintenanceRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('ASSIGNED');
      expect(data.assignedTo).toBe('cleaner-1');
      expect(data.assignedAt).toBeInstanceOf(Date);
      expect(data.resolvedAt).toBeUndefined();
    });

    it('PENDING_CONFIRM → COMPLETED 写入 resolvedAt', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', status: 'PENDING_CONFIRM' });
      prisma.maintenanceRequest.update.mockResolvedValue({ id: 'mr-1' });

      await service.update('mr-1', { status: 'COMPLETED', resolution: '已更换水龙头' } as any);

      const data = prisma.maintenanceRequest.update.mock.calls[0][0].data;
      expect(data.resolution).toBe('已更换水龙头');
      expect(data.resolvedAt).toBeInstanceOf(Date);
    });

    it('未完成时填 resolution 不会留下 resolvedAt', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', status: 'IN_PROGRESS' });
      prisma.maintenanceRequest.update.mockResolvedValue({ id: 'mr-1' });

      await service.update('mr-1', { resolution: '备件已到' } as any);

      const data = prisma.maintenanceRequest.update.mock.calls[0][0].data;
      expect(data.resolution).toBe('备件已到');
      expect(data.resolvedAt).toBeUndefined();
    });
  });

  describe('工单时间线与双向沟通（T283）', () => {
    it('租客只能看自己的工单；他人工单按 404', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });
      await expect(
        service.findMessages('mr-1', { userId: 'u1', role: 'TENANT', tenantId: 'tenant-2' }),
      ).rejects.toThrow(NotFoundException);

      prisma.maintenanceMessage.findMany.mockResolvedValue([{ id: 'm1', body: 'hi' }]);
      const result = await service.findMessages('mr-1', { userId: 'u1', role: 'TENANT', tenantId: 'tenant-1' });
      expect(result.data).toHaveLength(1);
      expect(prisma.maintenanceMessage.findMany).toHaveBeenCalledWith({
        where: { requestId: 'mr-1' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('留言写入类型 MESSAGE 并记录作者', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ tenantId: 'tenant-1' });
      await service.addMessage(
        'mr-1',
        { body: '  师傅什么时候到？  ' },
        { userId: 'u1', role: 'TENANT', tenantId: 'tenant-1' },
      );
      expect(prisma.maintenanceMessage.create).toHaveBeenCalledWith({
        data: {
          requestId: 'mr-1',
          type: 'MESSAGE',
          authorId: 'u1',
          authorRole: 'TENANT',
          body: '师傅什么时候到？',
        },
      });
    });

    it('状态变更写 SYSTEM 时间线；无变更不写', async () => {
      prisma.maintenanceRequest.findUnique.mockResolvedValue({ id: 'mr-1', status: 'SUBMITTED', assignedTo: null });
      prisma.maintenanceRequest.update.mockResolvedValue({ id: 'mr-1', status: 'ACKNOWLEDGED' });
      await service.update('mr-1', { status: 'ACKNOWLEDGED' } as never);
      expect(prisma.maintenanceMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: 'mr-1',
          type: 'SYSTEM',
          body: expect.stringContaining('状态 SUBMITTED → ACKNOWLEDGED'),
        }),
      });

      prisma.maintenanceMessage.create.mockClear();
      prisma.maintenanceRequest.update.mockResolvedValue({ id: 'mr-1', status: 'ACKNOWLEDGED' });
      await service.update('mr-1', {} as never);
      expect(prisma.maintenanceMessage.create).not.toHaveBeenCalled();
    });
  });
});
