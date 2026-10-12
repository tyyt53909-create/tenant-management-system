import { Test, TestingModule } from '@nestjs/testing';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

describe('TenantsController', () => {
  let controller: TenantsController;
  let service: TenantsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        {
          provide: TenantsService,
          useValue: {
            create: vi.fn(),
            findAll: vi.fn(),
            findOne: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TenantsController>(TenantsController);
    service = module.get<TenantsService>(TenantsService);
  });

  describe('create', () => {
    it('应该创建租客', async () => {
      const dto = {
        name: '张三',
        phone: '13800138000',
        email: 'zhangsan@example.com',
      };

      const mockTenant = { id: 'tenant-123', ...dto, isActive: true };
      vi.spyOn(service, 'create').mockResolvedValue(mockTenant as any);

      const result = await controller.create(dto);

      expect(result.id).toBe('tenant-123');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('应该返回租客列表', async () => {
      const mockResult = {
        data: [
          { id: 'tenant-1', name: '张三' },
          { id: 'tenant-2', name: '李四' },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 2,
          totalPages: 1,
        },
      };

      vi.spyOn(service, 'findAll').mockResolvedValue(mockResult as any);

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('findOne', () => {
    it('应该返回租客详情', async () => {
      const mockTenant = {
        id: 'tenant-123',
        name: '张三',
        phone: '13800138000',
      };

      vi.spyOn(service, 'findOne').mockResolvedValue(mockTenant as any);

      const result = await controller.findOne('tenant-123');

      expect(result.id).toBe('tenant-123');
      expect(service.findOne).toHaveBeenCalledWith('tenant-123');
    });
  });

  describe('update', () => {
    it('应该更新租客', async () => {
      const dto = { name: '张三（已更新）' };
      const mockTenant = { id: 'tenant-123', name: '张三（已更新）' };

      vi.spyOn(service, 'update').mockResolvedValue(mockTenant as any);

      const result = await controller.update('tenant-123', dto);

      expect(result.name).toBe('张三（已更新）');
      expect(service.update).toHaveBeenCalledWith('tenant-123', dto);
    });
  });

  describe('remove', () => {
    it('应该删除租客', async () => {
      const mockResult = { message: '租客已删除' };

      vi.spyOn(service, 'remove').mockResolvedValue(mockResult);

      const result = await controller.remove('tenant-123');

      expect(result.message).toBe('租客已删除');
      expect(service.remove).toHaveBeenCalledWith('tenant-123');
    });
  });
});
