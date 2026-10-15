import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TenantCapabilityService } from './tenant-capability.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { TENANT_CAPABILITIES } from './tenant-capability.catalog.js';

describe('TenantCapabilityService', () => {
  let service: TenantCapabilityService;
  let prisma: any;
  let auditLogService: any;

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      userCapabilityOverride: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn((fn) => fn(prisma)),
    };

    auditLogService = {
      log: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantCapabilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get<TenantCapabilityService>(TenantCapabilityService);
  });

  describe('getEffectiveCapabilities', () => {
    it('无任何覆写时，返回清单中全部 6 项预设允许的能力', async () => {
      prisma.userCapabilityOverride.findMany.mockResolvedValue([]);

      const effective = await service.getEffectiveCapabilities('u-1');
      expect(effective).toEqual(TENANT_CAPABILITIES.map((c) => c.code));
    });

    it('存在 DENY 覆写项时，该项从生效能力中被剔除', async () => {
      prisma.userCapabilityOverride.findMany.mockResolvedValue([
        {
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
        },
      ]);

      const effective = await service.getEffectiveCapabilities('u-1');
      expect(effective).not.toContain('tenant.maintenance.create');
      expect(effective).toContain('tenant.maintenance.read');
      expect(effective).toContain('tenant.bill.read');
    });
  });

  describe('hasCapability', () => {
    it('未知能力代码一律返回 false（未知代码不能当放行）', async () => {
      const allowed = await service.hasCapability('u-1', 'admin.secret.read');
      expect(allowed).toBe(false);
      expect(prisma.userCapabilityOverride.findUnique).not.toHaveBeenCalled();
    });

    it('无覆写时，合法能力代码默认返回 true', async () => {
      prisma.userCapabilityOverride.findUnique.mockResolvedValue(null);

      const allowed = await service.hasCapability('u-1', 'tenant.maintenance.create');
      expect(allowed).toBe(true);
    });

    it('存在 DENY 覆写时返回 false', async () => {
      prisma.userCapabilityOverride.findUnique.mockResolvedValue({
        userId: 'u-1',
        capability: 'tenant.maintenance.create',
        effect: 'DENY',
      });

      const allowed = await service.hasCapability('u-1', 'tenant.maintenance.create');
      expect(allowed).toBe(false);
    });

    it('存在 ALLOW 覆写时返回 true', async () => {
      prisma.userCapabilityOverride.findUnique.mockResolvedValue({
        userId: 'u-1',
        capability: 'tenant.maintenance.create',
        effect: 'ALLOW',
      });

      const allowed = await service.hasCapability('u-1', 'tenant.maintenance.create');
      expect(allowed).toBe(true);
    });
  });

  describe('getAccount & updateAccount', () => {
    it('租客不存在时抛出 NotFoundException', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(service.getAccount('t-none')).rejects.toThrow(NotFoundException);
    });

    it('未绑定账号的档案返回 UNREGISTERED 状态', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-unreg',
        user: null,
      });

      const res = await service.getAccount('t-unreg');
      expect(res.status).toBe('UNREGISTERED');
    });

    it('已绑定账号的档案返回 REGISTERED 状态与账号信息', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: {
          id: 'u-1',
          email: 't1@example.com',
          phone: '13800000001',
          isActive: true,
          lastLoginAt: new Date('2026-10-15T00:00:00Z'),
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
      });

      const res = await service.getAccount('t-1');
      expect(res.status).toBe('REGISTERED');
      if (res.status === 'REGISTERED') {
        expect(res.userId).toBe('u-1');
        expect(res.isActive).toBe(true);
      }
    });

    it('对未注册档案执行 updateAccount 抛出 409 ConflictException', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-unreg',
        user: null,
      });

      await expect(
        service.updateAccount('t-unreg', false, 'admin-1', '127.0.0.1', 'test-agent'),
      ).rejects.toThrow(ConflictException);
    });

    it('禁用登录账号时更新 User.isActive 并写入 DISABLE_TENANT_ACCOUNT 审计日志', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1', isActive: true },
      });

      const res = await service.updateAccount('t-1', false, 'admin-1', '10.0.0.1', 'Chrome');
      expect(res.success).toBe(true);
      expect(res.isActive).toBe(false);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { isActive: false },
      });

      expect(auditLogService.log).toHaveBeenCalledWith({
        userId: 'admin-1',
        action: 'DISABLE_TENANT_ACCOUNT',
        entityType: 'User',
        entityId: 'u-1',
        changes: {
          before: { isActive: true },
          after: { isActive: false },
        },
        ip: '10.0.0.1',
        userAgent: 'Chrome',
      });
    });

    it('状态未发生变化时不重复写入审计日志', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1', isActive: true },
      });

      const res = await service.updateAccount('t-1', true, 'admin-1', '10.0.0.1', 'Chrome');
      expect(res.success).toBe(true);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLogService.log).not.toHaveBeenCalled();
    });
  });

  describe('replaceCapabilities', () => {
    it('对未注册档案提交覆写抛出 409 ConflictException', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-unreg',
        user: null,
      });

      await expect(
        service.replaceCapabilities('t-unreg', ['tenant.maintenance.create'], 'admin-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('提交重复的能力代码抛出 400 BadRequestException', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1' },
      });

      await expect(
        service.replaceCapabilities(
          't-1',
          ['tenant.maintenance.create', 'tenant.maintenance.create'],
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('提交未知能力代码抛出 400 BadRequestException，不落库', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1' },
      });

      await expect(
        service.replaceCapabilities('t-1', ['admin.audit.delete'], 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.userCapabilityOverride.create).not.toHaveBeenCalled();
    });

    it('正常整批替换 DENY 记录并写入 UPDATE_TENANT_CAPABILITIES 审计日志', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1' },
      });

      const newOverride = [
        {
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: '频繁恶意报修',
          grantedBy: 'admin-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      prisma.userCapabilityOverride.findMany
        .mockResolvedValueOnce([]) // 旧覆写
        .mockResolvedValueOnce(newOverride) // 新覆写 getCapabilities 用
        .mockResolvedValueOnce(newOverride); // getEffectiveCapabilities 用

      const res = await service.replaceCapabilities(
        't-1',
        ['tenant.maintenance.create'],
        'admin-1',
        { 'tenant.maintenance.create': '频繁恶意报修' },
        '127.0.0.1',
        'Safari',
      );

      expect(res.status).toBe('REGISTERED');
      expect(prisma.userCapabilityOverride.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
      });
      expect(prisma.userCapabilityOverride.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: '频繁恶意报修',
          grantedBy: 'admin-1',
        },
      });

      expect(auditLogService.log).toHaveBeenCalledWith({
        userId: 'admin-1',
        action: 'UPDATE_TENANT_CAPABILITIES',
        entityType: 'User',
        entityId: 'u-1',
        changes: {
          before: { denied: [] },
          after: {
            denied: ['tenant.maintenance.create'],
            reasons: { 'tenant.maintenance.create': '频繁恶意报修' },
          },
        },
        ip: '127.0.0.1',
        userAgent: 'Safari',
      });
    });

    it('重复提交相同的 DENY 集合且原因未变时，不重复新增审计', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1' },
      });

      prisma.userCapabilityOverride.findMany.mockResolvedValue([
        {
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: '已有原因',
          grantedBy: 'admin-1',
        },
      ]);

      await service.replaceCapabilities(
        't-1',
        ['tenant.maintenance.create'],
        'admin-1',
        { 'tenant.maintenance.create': '已有原因' },
        '127.0.0.1',
        'Safari',
      );

      expect(auditLogService.log).not.toHaveBeenCalled();
      expect(prisma.userCapabilityOverride.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userCapabilityOverride.create).not.toHaveBeenCalled();
    });

    it('省略 reasons 时保留原有屏蔽原因，且不重写、不记审计', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1' },
      });
      prisma.userCapabilityOverride.findMany.mockResolvedValue([
        {
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: '已有原因',
          grantedBy: 'admin-1',
        },
      ]);

      await service.replaceCapabilities('t-1', ['tenant.maintenance.create'], 'admin-1');

      expect(auditLogService.log).not.toHaveBeenCalled();
      expect(prisma.userCapabilityOverride.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userCapabilityOverride.create).not.toHaveBeenCalled();
    });

    it('屏蔽名单变化且省略 reasons 时，保留仍被屏蔽项的原因并写入审计', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1' },
      });
      prisma.userCapabilityOverride.findMany.mockResolvedValue([
        {
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: '已有原因',
          grantedBy: 'admin-1',
        },
      ]);

      await service.replaceCapabilities('t-1', ['tenant.maintenance.create', 'tenant.bill.read'], 'admin-1');

      expect(prisma.userCapabilityOverride.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: '已有原因',
          grantedBy: 'admin-1',
        },
      });
      expect(prisma.userCapabilityOverride.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          capability: 'tenant.bill.read',
          effect: 'DENY',
          reason: null,
          grantedBy: 'admin-1',
        },
      });
      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_TENANT_CAPABILITIES',
          changes: {
            before: { denied: ['tenant.maintenance.create'] },
            after: {
              denied: ['tenant.maintenance.create', 'tenant.bill.read'],
              reasons: {
                'tenant.maintenance.create': '已有原因',
                'tenant.bill.read': null,
              },
            },
          },
        }),
      );
    });

    it('显式清空原因时记审计', async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: 't-1',
        user: { id: 'u-1' },
      });
      prisma.userCapabilityOverride.findMany.mockResolvedValue([
        {
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: '已有原因',
          grantedBy: 'admin-1',
        },
      ]);

      await service.replaceCapabilities(
        't-1',
        ['tenant.maintenance.create'],
        'admin-1',
        {},
      );

      expect(prisma.userCapabilityOverride.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          capability: 'tenant.maintenance.create',
          effect: 'DENY',
          reason: null,
          grantedBy: 'admin-1',
        },
      });
      expect(auditLogService.log).toHaveBeenCalled();
    });
  });
});
