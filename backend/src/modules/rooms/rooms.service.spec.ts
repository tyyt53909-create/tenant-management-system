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
              findUniqueOrThrow: vi.fn(),
              findMany: vi.fn(),
              count: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
              updateMany: vi.fn(),
              delete: vi.fn(),
            },
            contract: {
              findFirst: vi.fn(),
              count: vi.fn(),
            },
            maintenanceRequest: {
              findFirst: vi.fn(),
              count: vi.fn(),
            },
            checkoutRecord: {
              findFirst: vi.fn(),
              count: vi.fn(),
            },
            meter: {
              count: vi.fn(),
            },
            roomPhoto: {
              count: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
    prisma = module.get<PrismaService>(PrismaService);

    // 默认：无关联数据（remove 场景）
    vi.mocked(prisma.contract.count).mockResolvedValue(0);
    vi.mocked(prisma.maintenanceRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.checkoutRecord.count).mockResolvedValue(0);
    vi.mocked(prisma.meter.count).mockResolvedValue(0);
    vi.mocked(prisma.roomPhoto.count).mockResolvedValue(0);
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

    it('应该成功更新房源（合法流转 + 无 version 保持兼容，版本递增）', async () => {
      const mockRoom = {
        id: 'room-123',
        roomNumber: '101',
        buildingId: 'building-001',
        floor: 1,
        status: 'VACANT',
        cleanStatus: 'CLEAN',
        version: 2,
      };
      const updatedRoom = { ...mockRoom, status: 'MAINTENANCE', version: 3 };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.maintenanceRequest, 'findFirst').mockResolvedValue({ id: 'mr-1' } as any);
      vi.spyOn(prisma.room, 'update').mockResolvedValue(updatedRoom as any);

      const result = await service.update('room-123', dto);

      expect(result.status).toBe('MAINTENANCE');
      expect(prisma.room.update).toHaveBeenCalledWith({
        where: { id: 'room-123' },
        data: expect.objectContaining({ status: 'MAINTENANCE', version: { increment: 1 } }),
      });
    });

    it('非法房态流转应被拒绝（VACANT+CLEAN → OCCUPIED+CLEAN）', async () => {
      const mockRoom = { id: 'room-123', status: 'VACANT', cleanStatus: 'CLEAN' };
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);

      await expect(service.update('room-123', { status: 'OCCUPIED' } as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.room.update).not.toHaveBeenCalled();
    });

    it('提供 version 时走乐观锁（updateMany + 递增）', async () => {
      const mockRoom = {
        id: 'room-123',
        roomNumber: '101',
        buildingId: 'building-001',
        floor: 1,
        status: 'VACANT',
        cleanStatus: 'CLEAN',
        version: 3,
      };
      const updated = { ...mockRoom, description: '新描述', version: 4 };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.room, 'updateMany').mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.room, 'findUniqueOrThrow').mockResolvedValue(updated as any);

      const result = await service.update('room-123', {
        description: '新描述',
        version: 3,
      } as any);

      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-123', version: 3 },
        data: expect.objectContaining({ description: '新描述', version: { increment: 1 } }),
      });
      expect(result.version).toBe(4);
    });

    it('version 冲突应返回 409', async () => {
      const mockRoom = { id: 'room-123', status: 'VACANT', cleanStatus: 'CLEAN', version: 5 };
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.room, 'updateMany').mockResolvedValue({ count: 0 });

      await expect(
        service.update('room-123', { description: 'x', version: 4 } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('应该拒绝不存在的房源', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(null);

      await expect(service.update('room-999', dto)).rejects.toThrow(NotFoundException);
    });

    it('应该检查修改后的房号唯一性', async () => {
      const mockRoom = {
        id: 'room-123',
        roomNumber: '101',
        buildingId: 'building-001',
        floor: 1,
        status: 'VACANT',
        cleanStatus: 'CLEAN',
      };
      const existingRoom = { id: 'room-456', roomNumber: '102' };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.room, 'findFirst').mockResolvedValue(existingRoom as any);

      await expect(service.update('room-123', { roomNumber: '102' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateStatus', () => {
    const baseRoom = {
      id: 'room-123',
      roomNumber: '101',
      status: 'VACANT',
      cleanStatus: 'CLEAN',
      version: 3,
    };

    it('合法流转 VACANT+CLEAN → RESERVED+CLEAN（有草稿合同）', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(baseRoom as any);
      vi.spyOn(prisma.contract, 'findFirst').mockResolvedValue({
        id: 'contract-1',
        status: 'DRAFT',
      } as any);
      vi.spyOn(prisma.room, 'updateMany').mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.room, 'findUniqueOrThrow').mockResolvedValue({
        ...baseRoom,
        status: 'RESERVED',
        version: 4,
      } as any);

      const result = await service.updateStatus('room-123', {
        status: 'RESERVED',
        version: 3,
      } as any);

      expect(prisma.room.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-123', version: 3 },
        data: { status: 'RESERVED', cleanStatus: 'CLEAN', version: { increment: 1 } },
      });
      expect(result.status).toBe('RESERVED');
    });

    it('缺少草稿合同：流转 RESERVED 被拒绝', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(baseRoom as any);
      vi.spyOn(prisma.contract, 'findFirst').mockResolvedValue(null);

      await expect(
        service.updateStatus('room-123', { status: 'RESERVED', version: 3 } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.room.updateMany).not.toHaveBeenCalled();
    });

    it('非法流转 VACANT+CLEAN → OCCUPIED+CLEAN 被拒绝', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(baseRoom as any);

      await expect(
        service.updateStatus('room-123', { status: 'OCCUPIED', version: 3 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('退租流转缺少退租记录被拒绝', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue({
        ...baseRoom,
        status: 'OCCUPIED',
      } as any);
      vi.spyOn(prisma.checkoutRecord, 'findFirst').mockResolvedValue(null);

      await expect(
        service.updateStatus('room-123', { cleanStatus: 'PENDING_CLEAN', version: 3 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('转维修缺少报修工单被拒绝', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(baseRoom as any);
      vi.spyOn(prisma.maintenanceRequest, 'findFirst').mockResolvedValue(null);

      await expect(
        service.updateStatus('room-123', { status: 'MAINTENANCE', version: 3 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('保洁流转 CLEANING → CLEAN 合法', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue({
        ...baseRoom,
        cleanStatus: 'CLEANING',
      } as any);
      vi.spyOn(prisma.room, 'updateMany').mockResolvedValue({ count: 1 });
      vi.spyOn(prisma.room, 'findUniqueOrThrow').mockResolvedValue({
        ...baseRoom,
        cleanStatus: 'CLEAN',
        version: 4,
      } as any);

      const result = await service.updateStatus('room-123', {
        cleanStatus: 'CLEAN',
        version: 3,
      } as any);

      expect(result.cleanStatus).toBe('CLEAN');
    });

    it('版本冲突返回 409', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(baseRoom as any);
      vi.spyOn(prisma.contract, 'findFirst').mockResolvedValue({ id: 'c1' } as any);
      vi.spyOn(prisma.room, 'updateMany').mockResolvedValue({ count: 0 });

      await expect(
        service.updateStatus('room-123', { status: 'RESERVED', version: 999 } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('未提供 status/cleanStatus：400', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(baseRoom as any);

      await expect(service.updateStatus('room-123', { version: 3 } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('房源不存在：404', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(null);

      await expect(
        service.updateStatus('room-999', { status: 'RESERVED', version: 1 } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('应该成功删除房源（无关联数据）', async () => {
      const mockRoom = { id: 'room-123', roomNumber: '101' };

      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(mockRoom as any);
      vi.spyOn(prisma.room, 'delete').mockResolvedValue(mockRoom as any);

      const result = await service.remove('room-123');

      expect(result.message).toBe('房源已删除');
      expect(prisma.room.delete).toHaveBeenCalledWith({ where: { id: 'room-123' } });
    });

    it('有关联数据时应拒绝删除（T139）', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue({ id: 'room-123' } as any);
      vi.spyOn(prisma.contract, 'count').mockResolvedValue(1);

      await expect(service.remove('room-123')).rejects.toThrow(BadRequestException);
      expect(prisma.room.delete).not.toHaveBeenCalled();
    });

    it('应该拒绝不存在的房源', async () => {
      vi.spyOn(prisma.room, 'findUnique').mockResolvedValue(null);

      await expect(service.remove('room-999')).rejects.toThrow(NotFoundException);
    });
  });
});
