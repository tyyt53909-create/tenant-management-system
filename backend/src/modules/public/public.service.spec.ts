import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

describe('PublicService（公开看房 P1 / T155 & T298 / LSE-01）', () => {
  let service: PublicService;
  let prisma: any;
  let notificationsService: any;

  const reachable = {
    id: 'room-1',
    roomNumber: '101',
    floor: 1,
    roomType: 'SINGLE',
    area: 25.5,
    facilities: { wifi: true },
    description: '朝南',
    listingPrice: 250000,
    isListed: true,
    availableDate: new Date('2026-11-01'),
    building: { id: 'b-1', name: 'A栋', address: '某路 1 号' },
    photos: [],
    roomShape: null,
  };

  beforeEach(async () => {
    const prismaMock: any = {
      room: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
      building: { findMany: vi.fn() },
      lead: { create: vi.fn() },
      viewingAppointment: { create: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'admin-1' }]) },
    };

    notificationsService = {
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<PublicService>(PublicService);
    prisma = prismaMock;
  });

  describe('listRooms', () => {
    it('查询条件固定为 VACANT + CLEAN（只暴露可租房源）', async () => {
      prisma.room.findMany.mockResolvedValue([reachable]);
      prisma.room.count.mockResolvedValue(1);

      await service.listRooms({ page: 1, limit: 20 } as any);

      const where = prisma.room.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('VACANT');
      expect(where.cleanStatus).toBe('CLEAN');
    });

    it('使用显式 select 白名单，不含租客/合同关联', async () => {
      prisma.room.findMany.mockResolvedValue([reachable]);
      prisma.room.count.mockResolvedValue(1);

      await service.listRooms({ page: 1, limit: 20 } as any);

      const select = prisma.room.findMany.mock.calls[0][0].select;
      expect(select).toBeDefined();
      expect(select.contracts).toBeUndefined();
      expect(select.tenant).toBeUndefined();
      expect(select.cleanStatus).toBeUndefined();
      expect(select.version).toBeUndefined();
      // 白名单内应含展示所需字段
      expect(select.roomNumber).toBe(true);
      expect(select.building).toBeDefined();
    });

    it('不为租客数据做任何额外查询（无 contract/tenant 调用）', async () => {
      prisma.room.findMany.mockResolvedValue([]);
      prisma.room.count.mockResolvedValue(0);

      await service.listRooms({ page: 1, limit: 20 } as any);

      expect(prisma.contract).toBeUndefined();
      expect(prisma.tenant).toBeUndefined();
    });

    it('支持 buildingId / floor / roomType 过滤并分页', async () => {
      prisma.room.findMany.mockResolvedValue([]);
      prisma.room.count.mockResolvedValue(0);

      const result = await service.listRooms({
        page: 2,
        limit: 10,
        buildingId: 'b-1',
        floor: 3,
        roomType: 'TWO_BED',
      } as any);

      const args = prisma.room.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        status: 'VACANT',
        cleanStatus: 'CLEAN',
        buildingId: 'b-1',
        floor: 3,
        roomType: 'TWO_BED',
      });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(result.meta).toEqual({ page: 2, limit: 10, total: 0, totalPages: 0 });
    });
  });

  describe('getRoom', () => {
    it('可租房源 → 返回', async () => {
      prisma.room.findFirst.mockResolvedValue(reachable);

      const result = await service.getRoom('room-1');

      expect(result.id).toBe('room-1');
      const args = prisma.room.findFirst.mock.calls[0][0];
      expect(args.where).toMatchObject({ id: 'room-1', status: 'VACANT', cleanStatus: 'CLEAN' });
    });

    it('不可租或不存在 → 404（不暴露存在性）', async () => {
      prisma.room.findFirst.mockResolvedValue(null);

      await expect(service.getRoom('room-occupied')).rejects.toThrow(NotFoundException);
    });

    it('详情同样使用 select 白名单', async () => {
      prisma.room.findFirst.mockResolvedValue(reachable);

      await service.getRoom('room-1');

      expect(prisma.room.findFirst.mock.calls[0][0].select).toBeDefined();
      expect(prisma.room.findFirst.mock.calls[0][0].select.contracts).toBeUndefined();
    });
  });

  describe('listBuildings', () => {
    it('仅返回含可租房源的楼栋，且只暴露 id/name/address', async () => {
      prisma.building.findMany.mockResolvedValue([{ id: 'b-1', name: 'A栋', address: 'x' }]);

      await service.listBuildings();

      const args = prisma.building.findMany.mock.calls[0][0];
      expect(args.where.rooms).toEqual({ some: { status: 'VACANT', cleanStatus: 'CLEAN' } });
      expect(args.select).toEqual({ id: true, name: true, address: true });
    });
  });

  describe('招租与预约 (LSE-01 / T298)', () => {
    it('listRooms：支持 minPrice 与 maxPrice 价格区间过滤', async () => {
      prisma.room.findMany.mockResolvedValue([reachable]);
      prisma.room.count.mockResolvedValue(1);

      await service.listRooms({ minPrice: 200000, maxPrice: 300000 } as any);

      const where = prisma.room.findMany.mock.calls[0][0].where;
      expect(where.isListed).toBe(true);
      expect(where.listingPrice).toEqual({ gte: 200000, lte: 300000 });
    });

    it('getRoomShareInfo：生成格式化标题、描述与小程序路径', async () => {
      prisma.room.findFirst.mockResolvedValue(reachable);

      const info = await service.getRoomShareInfo('room-1');

      expect(info.roomId).toBe('room-1');
      expect(info.title).toContain('A栋 101室 · SINGLE (¥2500.00/月)');
      expect(info.path).toBe('/pages/index/index?roomId=room-1');
      expect(info.priceText).toBe('¥2500.00/月');
    });

    it('createLead：成功留资并通知管理员', async () => {
      prisma.lead.create.mockResolvedValue({
        id: 'lead-1',
        createdAt: new Date(),
        source: 'MINIPROGRAM',
      });

      const res = await service.createLead({
        name: '张三',
        phone: '13800000000',
        budgetMin: 200000,
        budgetMax: 300000,
      });

      expect(res.id).toBe('lead-1');
      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: '张三',
            phone: '13800000000',
            status: 'NEW',
          }),
        }),
      );
      expect(notificationsService.create).toHaveBeenCalled();
    });

    it('createLead：关联房源不存在时抛出 BadRequestException', async () => {
      prisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.createLead({
          name: '张三',
          phone: '13800000000',
          roomId: 'not-exist',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('createAppointment：成功发起预约看房并通知管理员', async () => {
      prisma.room.findFirst.mockResolvedValue(reachable);
      const futureTime = new Date(Date.now() + 86400000).toISOString();
      prisma.viewingAppointment.create.mockResolvedValue({
        id: 'appt-1',
        status: 'PENDING',
        appointmentTime: new Date(futureTime),
      });

      const res = await service.createAppointment(
        {
          roomId: 'room-1',
          name: '李四',
          phone: '13900000000',
          appointmentTime: futureTime,
          visitorsCount: 2,
        },
        'user-1',
      );

      expect(res.id).toBe('appt-1');
      expect(res.status).toBe('PENDING');
      expect(prisma.viewingAppointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roomId: 'room-1',
            name: '李四',
            phone: '13900000000',
            userId: 'user-1',
            status: 'PENDING',
          }),
        }),
      );
      expect(notificationsService.create).toHaveBeenCalled();
    });

    it('createAppointment：房源不可看抛出 404', async () => {
      prisma.room.findFirst.mockResolvedValue(null);

      await expect(
        service.createAppointment({
          roomId: 'room-occupied',
          name: '李四',
          phone: '13900000000',
          appointmentTime: new Date(Date.now() + 86400000).toISOString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('createAppointment：预约过去时间抛出 BadRequestException', async () => {
      prisma.room.findFirst.mockResolvedValue(reachable);
      const pastTime = new Date(Date.now() - 86400000).toISOString();

      await expect(
        service.createAppointment({
          roomId: 'room-1',
          name: '李四',
          phone: '13900000000',
          appointmentTime: pastTime,
        }),
      ).rejects.toThrow('预约看房时间必须为未来时间');
    });
  });
});
