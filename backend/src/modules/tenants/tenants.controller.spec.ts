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
            findOneForTenant: vi.fn(),
            update: vi.fn(),
            remove: vi.fn(),
            revealIdNumber: vi.fn(),
            getMyRegistration: vi.fn(),
            submitMyRegistration: vi.fn(),
            getMyOverview: vi.fn(),
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
    it('管理者应该返回任意租客详情', async () => {
      const mockTenant = {
        id: 'tenant-123',
        name: '张三',
        phone: '13800138000',
      };

      vi.spyOn(service, 'findOne').mockResolvedValue(mockTenant as any);

      const result = await controller.findOne({ user: { role: 'ADMIN' } }, 'tenant-123');

      expect(result.id).toBe('tenant-123');
      expect(service.findOne).toHaveBeenCalledWith('tenant-123');
    });

    it('租客查看详情应走 findOneForTenant（只允许自己）', async () => {
      const mockTenant = { id: 'tenant-123', name: '张三' };
      const spyForTenant = vi
        .spyOn(service, 'findOneForTenant')
        .mockResolvedValue(mockTenant as any);
      const spyFindOne = vi.spyOn(service, 'findOne');

      const result = await controller.findOne(
        { user: { role: 'TENANT', tenantId: 'tenant-123' } },
        'tenant-123',
      );

      expect(result.id).toBe('tenant-123');
      expect(spyForTenant).toHaveBeenCalledWith('tenant-123', 'tenant-123');
      expect(spyFindOne).not.toHaveBeenCalled();
    });
  });

  describe('revealIdNumber', () => {
    it('把管理员、来源 IP 和 User-Agent 交给服务', async () => {
      vi.spyOn(service, 'revealIdNumber').mockResolvedValue({
        idNumber: '440101199001011234',
        idType: 'ID_CARD',
      } as any);

      await controller.revealIdNumber(
        { user: { userId: 'admin-1' }, ip: '10.0.0.8', headers: { 'user-agent': 'browser' } },
        'tenant-1',
      );

      expect(service.revealIdNumber).toHaveBeenCalledWith('tenant-1', {
        userId: 'admin-1',
        ip: '10.0.0.8',
        userAgent: 'browser',
      });
    });
  });

  describe('update', () => {
    it('应该更新租客', async () => {
      const dto = { name: '张三（已更新）' };
      const mockTenant = { id: 'tenant-123', name: '张三（已更新）' };

      vi.spyOn(service, 'update').mockResolvedValue(mockTenant as any);

      const result = await controller.update(
        { user: { userId: 'admin-1' }, ip: '10.0.0.8', headers: { 'user-agent': 'browser' } },
        'tenant-123',
        dto,
      );

      expect(result.name).toBe('张三（已更新）');
      expect(service.update).toHaveBeenCalledWith('tenant-123', dto, {
        userId: 'admin-1',
        ip: '10.0.0.8',
        userAgent: 'browser',
      });
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

  describe('tenant self-service endpoints (LSE-05 / T297)', () => {
    it('getMyRegistration 委托 tenantsService', async () => {
      vi.spyOn(service, 'getMyRegistration').mockResolvedValue({ status: 'PENDING' } as any);
      const userParam = { user: { id: 'u1', role: 'TENANT', tenantId: 't1' } } as any;
      const res = await controller.getMyRegistration(userParam);
      expect(res).toEqual({ status: 'PENDING' });
      expect(service.getMyRegistration).toHaveBeenCalledWith('t1');
    });

    it('submitMyRegistration 传递租客身份与审计上下文', async () => {
      vi.spyOn(service, 'submitMyRegistration').mockResolvedValue({ message: '提交成功' } as any);
      const userParam = { user: { id: 'u1', role: 'TENANT', tenantId: 't1' } } as any;
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'agent' } } as any;
      const dto = { idType: 'ID_CARD' as any, idNumber: '110101199001011234' };

      const res = await controller.submitMyRegistration(req, userParam, dto);
      expect(res).toEqual({ message: '提交成功' });
      expect(service.submitMyRegistration).toHaveBeenCalledWith('t1', dto, {
        userId: 'u1',
        ip: '127.0.0.1',
        userAgent: 'agent',
      });
    });

    it('getMyOverview 聚合租客总览', async () => {
      vi.spyOn(service, 'getMyOverview').mockResolvedValue({ bound: true } as any);
      const userParam = { user: { id: 'u1', role: 'TENANT', tenantId: 't1' } } as any;
      const res = await controller.getMyOverview(userParam);
      expect(res).toEqual({ bound: true });
      expect(service.getMyOverview).toHaveBeenCalledWith('u1', 't1');
    });
  });
});
