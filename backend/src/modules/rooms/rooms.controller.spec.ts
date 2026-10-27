import { Test, TestingModule } from '@nestjs/testing';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';

describe('RoomsController', () => {
  let controller: RoomsController;
  let service: RoomsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [
        {
          provide: RoomsService,
          useValue: {
            create: vi.fn(),
            findAll: vi.fn(),
            findOne: vi.fn(),
            update: vi.fn(),
            updateStatus: vi.fn(),
            markClean: vi.fn(),
            remove: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<RoomsController>(RoomsController);
    service = module.get<RoomsService>(RoomsService);
  });

  describe('create', () => {
    it('应该创建房源', async () => {
      const dto = {
        roomNumber: '101',
        buildingId: 'building-001',
        floor: 1,
        roomType: 'SINGLE',
        area: 25.5,
      } as any;

      const mockRoom = { id: 'room-123', ...dto, status: 'VACANT' };
      vi.spyOn(service, 'create').mockResolvedValue(mockRoom as any);

      const result = await controller.create(dto);

      expect(result.id).toBe('room-123');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('应该返回房源列表', async () => {
      const mockResult = {
        data: [
          { id: 'room-1', roomNumber: '101' },
          { id: 'room-2', roomNumber: '102' },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 2,
          totalPages: 1,
        },
      };

      vi.spyOn(service, 'findAll').mockResolvedValue(mockResult as any);

      const result = await controller.findAll(
        { user: { role: 'ADMIN' } },
        { page: 1, limit: 20 } as any,
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(service.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 }, 'ADMIN', undefined);
    });

    it('租客列表必须携带 tenantId 交由服务层过滤', async () => {
      vi.spyOn(service, 'findAll').mockResolvedValue({ data: [], meta: {} } as any);

      await controller.findAll(
        { user: { role: 'TENANT', tenantId: 'tenant-123' } },
        { page: 1, limit: 20 } as any,
      );

      expect(service.findAll).toHaveBeenCalledWith(
        { page: 1, limit: 20 },
        'TENANT',
        'tenant-123',
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

      vi.spyOn(service, 'findOne').mockResolvedValue(mockRoom as any);

      const result = await controller.findOne({ user: { role: 'ADMIN' } }, 'room-123');

      expect(result.id).toBe('room-123');
      expect(service.findOne).toHaveBeenCalledWith('room-123', 'ADMIN', undefined);
    });
  });

  describe('update', () => {
    it('应该更新房源', async () => {
      const dto = { status: 'MAINTENANCE' } as any;
      const mockRoom = { id: 'room-123', roomNumber: '101', status: 'MAINTENANCE' };

      vi.spyOn(service, 'update').mockResolvedValue(mockRoom as any);

      const result = await controller.update('room-123', dto);

      expect(result.status).toBe('MAINTENANCE');
      expect(service.update).toHaveBeenCalledWith('room-123', dto);
    });
  });

  describe('remove', () => {
    it('应该删除房源', async () => {
      const mockResult = { message: '房源已删除' };

      vi.spyOn(service, 'remove').mockResolvedValue(mockResult);

      const result = await controller.remove('room-123');

      expect(result.message).toBe('房源已删除');
      expect(service.remove).toHaveBeenCalledWith('room-123');
    });
  });

  describe('updateStatus', () => {
    it('应该透传房态流转参数（version 乐观锁）', async () => {
      const dto = { status: 'VACANT', cleanStatus: 'PENDING_CLEAN', version: 3 } as any;
      vi.spyOn(service, 'updateStatus').mockResolvedValue({ id: 'room-123', version: 4 } as any);

      const result = await controller.updateStatus({ user: { role: 'ADMIN', userId: 'admin-1' } }, 'room-123', dto);

      expect(result.version).toBe(4);
      expect(service.updateStatus).toHaveBeenCalledWith('room-123', dto, 'ADMIN');
    });

    it('保洁调用必须把角色交给服务层收窄', async () => {
      const dto = { cleanStatus: 'CLEANING', version: 2 } as any;
      vi.spyOn(service, 'updateStatus').mockResolvedValue({ id: 'room-123', version: 3 } as any);

      await controller.updateStatus({ user: { role: 'CLEANER', userId: 'cleaner-1' } }, 'room-123', dto);

      expect(service.updateStatus).toHaveBeenCalledWith('room-123', dto, 'CLEANER');
    });
  });

  describe('markClean', () => {
    it('应该透传标记已清洁参数（可带照片）', async () => {
      const dto = { version: 2, photo: { fileUrl: 'https://oss.example.com/a.jpg' } } as any;
      vi.spyOn(service, 'markClean').mockResolvedValue({
        room: { id: 'room-123' },
        photo: null,
      } as any);

      const result = await controller.markClean('room-123', dto);

      expect(result.room.id).toBe('room-123');
      expect(service.markClean).toHaveBeenCalledWith('room-123', dto);
    });
  });
});
