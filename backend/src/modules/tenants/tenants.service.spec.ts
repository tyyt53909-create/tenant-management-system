import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TENANT_PUBLIC_SELECT, TenantsService } from './tenants.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        {
          provide: PrismaService,
          useValue: {
            tenant: {
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

    service = module.get<TenantsService>(TenantsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create', () => {
    const dto = {
      name: '张三',
      phone: '13800138000',
      email: 'zhangsan@example.com',
    };

    it('应该成功创建租客', async () => {
      const mockTenant = { id: 'tenant-123', ...dto, isActive: true };

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.tenant, 'create').mockResolvedValue(mockTenant as any);

      const result = await service.create(dto);

      expect(result.name).toBe('张三');
      expect(result.phone).toBe('13800138000');
    });

    it('应该拒绝重复的手机号', async () => {
      const existingTenant = { id: 'tenant-123', phone: '13800138000' };

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(existingTenant as any);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('应该拒绝重复的邮箱', async () => {
      const existingEmail = { id: 'tenant-456', email: 'zhangsan@example.com' };

      vi.spyOn(prisma.tenant, 'findUnique')
        .mockResolvedValueOnce(null) // 手机号检查通过
        .mockResolvedValueOnce(existingEmail as any); // 邮箱重复

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('应该返回分页列表', async () => {
      const mockTenants = [
        { id: 'tenant-1', name: '张三', phone: '13800138000' },
        { id: 'tenant-2', name: '李四', phone: '13800138001' },
      ];

      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue(mockTenants as any);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    it('应该支持激活状态筛选', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, isActive: true });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('应该返回租客详情', async () => {
      const mockTenant = {
        id: 'tenant-123',
        name: '张三',
        phone: '13800138000',
        user: { id: 'user-123', email: 'zhangsan@example.com' },
      };

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(mockTenant as any);

      const result = await service.findOne('tenant-123');

      expect(result.name).toBe('张三');
    });

    it('应该拒绝不存在的租客', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);

      await expect(service.findOne('tenant-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const dto = { name: '张三（已更新）' };

    it('应该成功更新租客', async () => {
      const mockTenant = { id: 'tenant-123', name: '张三', phone: '13800138000' };
      const updatedTenant = { ...mockTenant, name: '张三（已更新）' };

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(mockTenant as any);
      vi.spyOn(prisma.tenant, 'update').mockResolvedValue(updatedTenant as any);

      const result = await service.update('tenant-123', dto);

      expect(result.name).toBe('张三（已更新）');
    });

    it('应该拒绝不存在的租客', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);

      await expect(service.update('tenant-999', dto)).rejects.toThrow(NotFoundException);
    });

    it('应该检查修改后的手机号唯一性', async () => {
      const mockTenant = { id: 'tenant-123', phone: '13800138000' };
      const existingPhone = { id: 'tenant-456', phone: '13800138001' };

      vi.spyOn(prisma.tenant, 'findUnique')
        .mockResolvedValueOnce(mockTenant as any)
        .mockResolvedValueOnce(existingPhone as any);

      await expect(service.update('tenant-123', { phone: '13800138001' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('remove', () => {
    it('应该成功删除租客', async () => {
      const mockTenant = { id: 'tenant-123', name: '张三' };

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(mockTenant as any);
      vi.spyOn(prisma.tenant, 'delete').mockResolvedValue(mockTenant as any);

      const result = await service.remove('tenant-123');

      expect(result.message).toBe('租客已删除');
    });

    it('应该拒绝不存在的租客', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);

      await expect(service.remove('tenant-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('脱敏白名单（T148）', () => {
    it('列表查询使用字段白名单，不含证件号与登记表关联', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([] as any);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20 });

      const args = (prisma.tenant.findMany as any).mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.include).toBeUndefined();
      expect(args.select).not.toHaveProperty('registration');
      expect(args.select).not.toHaveProperty('idNumber');
      expect(args.select).toMatchObject({ id: true, name: true, phone: true });
    });

    it('详情查询使用字段白名单，证件号不会被带出', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-123' } as any);

      await service.findOne('tenant-123');

      const args = (prisma.tenant.findUnique as any).mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expect(args.select).not.toHaveProperty('registration');
      expect(args.select).not.toHaveProperty('idNumber');
      expect(args.select.user).toEqual({ select: { id: true, email: true, role: true } });
    });

    it('白名单常量本身不含敏感字段（含证件号）', () => {
      const keys = Object.keys(TENANT_PUBLIC_SELECT);
      expect(keys).not.toContain('idNumber');
      expect(keys).not.toContain('registration');
      expect(keys).toContain('id');
      expect(keys).toContain('name');
    });
  });

  describe('findOneForTenant（租客仅可看自己，T148）', () => {
    it('租客查看自己的档案 → 返回', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: 'tenant-1',
        name: '张三',
      } as any);

      const result = await service.findOneForTenant('tenant-1', 'tenant-1');

      expect(result.id).toBe('tenant-1');
    });

    it('租客查看他人档案 → 404（不暴露存在性）', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: 'tenant-2',
        name: '李四',
      } as any);

      await expect(service.findOneForTenant('tenant-2', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('租客账号未绑定租客档案（tenantId 缺失）→ 404', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-1' } as any);

      await expect(service.findOneForTenant('tenant-1', undefined)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
