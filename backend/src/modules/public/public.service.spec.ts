import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('PublicService（公开看房 P1 / T155）', () => {
  let service: PublicService;
  let prisma: any;

  const reachable = {
    id: 'room-1',
    roomNumber: '101',
    floor: 1,
    roomType: 'SINGLE',
    area: 25.5,
    facilities: { wifi: true },
    description: '朝南',
    building: { name: 'A栋', address: '某路 1 号' },
    photos: [],
  };

  beforeEach(async () => {
    const prismaMock: any = {
      room: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
      building: { findMany: vi.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PublicService, { provide: PrismaService, useValue: prismaMock }],
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
});
