import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { RoomsService } from './rooms.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('RoomsService', () => {
  let service: RoomsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        {
          provide: PrismaService,
          useValue: {
            building: {
              findUnique: vi.fn(),
            },
            room: {
              findFirst: vi.fn(),
              findUnique: vi.fn(),
              findMany: vi.fn(),
              count: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create', () => {
    const dto = {
      roomNumber: '101',
      buildingId: 'building-001',
      floor: 1,
      roomType: 'SINGLE',
      area: 25.5,
    } as any;

    it('应该成功创建房源', async () => {
      const mockBuilding = { id: 'building-001', name: '默认楼栋' };
      const mockRoom = { id: 'room-123', ...dto, status: 'VACANT' };

      vi.spyOn(prisma.building, 'findUnique').mockResolvedValue(mockBuilding as any);
      vi.spyOn(prisma.room, 'findFirst').mockResolvedValue(null);
      vi.spyOn(prisma.room, 'create').mockResolvedValue(mockRoom as any);

      const result = await service.create(dto);

      expect(result.roomNumber).toBe('101');
      expect(result.status).toBe('VACANT');
      expect(prisma.room.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          roomNumber: '101',
          status: 'VACANT',
          cleanStatus: 'CLEAN',
        }),
      });
    });

    it('应该拒绝不存在的楼栋', async () => {
      vi.spyOn(prisma.building, 'findUnique').mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('应该拒绝重复的房号', async () => {
      const mockBuilding = { id: 'building-001', name: '默认楼栋' };
      const existingRoom = { id: 'room-123', roomNumber: '101' };

      vi.spyOn(prisma.building, 'findUnique').mockResolvedValue(mockBuilding as any);
      vi.spyOn(prisma.room, 'findFirst').mockResolvedValue(existingRoom as any);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('应该返回分页列表', async () => {
      const mockRooms = [
        { id: 'room-1', roomNumber: '101', status: 'VACANT' },
        { id: 'room-2', roomNumber: '102', status: 'OCCUPIED' },
      ];

      vi.spyOn(prisma.room, 'findMany').mockResolvedValue(mockRooms as any);
      vi.spyOn(prisma.room, 'count').mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(1);
    });

    it('应该支持状态筛选', async () => {
      vi.spyOn(prisma.room, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.room, 'count').mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, status: 'VACANT' } as any);

      expect(prisma.room.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'VACANT' },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('应该返回房源详情', async () => {
      const mockRoom = {
        id: 'room-123',
        roomNumber: '101',
        building: { id: 'building-001', name: '默认楼栋' },
      };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);

      const result = await service.findOne('room-123');

      expect(result.roomNumber).toBe('101');
      expect(result.building.name).toBe('默认楼栋');
    });

    it('应该拒绝不存在的房源', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('room-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const dto = { status: 'MAINTENANCE' } as any;

    it('应该成功更新房源', async () => {
      const mockRoom = { id: 'room-123', roomNumber: '101', buildingId: 'building-001', floor: 1 };
      const updatedRoom = { ...mockRoom, status: 'MAINTENANCE' };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.room, 'update').mockResolvedValue(updatedRoom as any);

      const result = await service.update('room-123', dto);

      expect(result.status).toBe('MAINTENANCE');
    });

    it('应该拒绝不存在的房源', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(null);

      await expect(service.update('room-999', dto)).rejects.toThrow(NotFoundException);
    });

    it('应该检查修改后的房号唯一性', async () => {
      const mockRoom = { id: 'room-123', roomNumber: '101', buildingId: 'building-001', floor: 1 };
      const existingRoom = { id: 'room-456', roomNumber: '102' };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.room, 'findFirst').mockResolvedValue(existingRoom as any);

      await expect(service.update('room-123', { roomNumber: '102' })).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('应该成功删除房源', async () => {
      const mockRoom = { id: 'room-123', roomNumber: '101' };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.room, 'delete').mockResolvedValue(mockRoom as any);

      const result = await service.remove('room-123');

      expect(result.message).toBe('房源已删除');
      expect(prisma.room.delete).toHaveBeenCalledWith({ where: { id: 'room-123' } });
    });

    it('应该拒绝不存在的房源', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(null);

      await expect(service.remove('room-999')).rejects.toThrow(NotFoundException);
    });
  });
});
