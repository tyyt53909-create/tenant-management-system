import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TENANT_PUBLIC_SELECT, TenantsService } from './tenants.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: PrismaService;
  let crypto: {
    maskStored: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
    encrypt: ReturnType<typeof vi.fn>;
    hashIdNumber: ReturnType<typeof vi.fn>;
  };
  let auditLog: { log: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    crypto = {
      maskStored: vi.fn((value: string) => `masked:${value}`),
      decrypt: vi.fn(),
      encrypt: vi.fn((plain: string) => `enc:${plain}`),
      hashIdNumber: vi.fn((plain: string) => `hash:${plain}`),
    };
    auditLog = { log: vi.fn() };
    const prismaMock: any = {
      tenant: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      tenantRegistration: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      tag: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    prismaMock.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CryptoService, useValue: crypto },
        { provide: AuditLogService, useValue: auditLog },
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

    it('T160 支持姓名模糊查询（大小写不敏感）', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, name: '张' });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: '张', mode: 'insensitive' } },
        }),
      );
    });

    it('T160 支持手机号模糊查询（可只输后几位）', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, phone: '8000' });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phone: { contains: '8000' } },
        }),
      );
    });

    it('T160 空串/纯空格视为不筛选（避免查不到任何数据）', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, name: '   ', phone: '' });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('T160 多个条件叠加', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(0);

      await service.findAll({ page: 2, limit: 10, name: '李', phone: '139', isActive: false });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: false,
            name: { contains: '李', mode: 'insensitive' },
            phone: { contains: '139' },
          },
          skip: 10,
          take: 10,
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

  describe('标签（T215）', () => {
    const tenant = { id: 'tenant-123', name: '张三', phone: '13800138000' };

    it('创建时按 tagIds 建立关联', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.tag, 'findMany').mockResolvedValue([{ id: 'tag-a' }, { id: 'tag-b' }] as any);
      const create = vi.spyOn(prisma.tenant, 'create').mockResolvedValue(tenant as any);

      await service.create({ name: '张三', phone: '13800138000', tagIds: ['tag-a', 'tag-b', 'tag-a'] });

      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['tag-a', 'tag-b'] } },
        select: { id: true },
      });
      expect(create.mock.calls[0][0].data.tags).toEqual({
        create: [{ tagId: 'tag-a' }, { tagId: 'tag-b' }],
      });
    });

    it('创建时标签不存在 → 400，且不写库', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.tag, 'findMany').mockResolvedValue([{ id: 'tag-a' }] as any);
      const create = vi.spyOn(prisma.tenant, 'create');

      await expect(
        service.create({ name: '张三', phone: '13800138000', tagIds: ['tag-a', 'tag-ghost'] }),
      ).rejects.toThrow(BadRequestException);
      expect(create).not.toHaveBeenCalled();
    });

    it('更新时未传 tagIds → 不动标签', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(tenant as any);
      const update = vi.spyOn(prisma.tenant, 'update').mockResolvedValue(tenant as any);

      await service.update('tenant-123', { name: '张三（已更新）' });

      expect(update.mock.calls[0][0].data).not.toHaveProperty('tags');
    });

    it('更新时传空数组 → 清空标签', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(tenant as any);
      const update = vi.spyOn(prisma.tenant, 'update').mockResolvedValue(tenant as any);

      await service.update('tenant-123', { tagIds: [] });

      expect(update.mock.calls[0][0].data.tags).toEqual({ deleteMany: {}, create: [] });
    });

    it('列表可带 tagId 筛选', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(0);

      await service.findAll({ page: 1, limit: 20, tagId: 'tag-a' });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tags: { some: { tagId: 'tag-a' } } } }),
      );
    });

    it('响应把关联行摊平成 { id, name }', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        ...tenant,
        tags: [{ tag: { id: 'tag-a', name: '学生' } }],
      } as any);

      const result = await service.findOne('tenant-123');

      expect(result.tags).toEqual([{ id: 'tag-a', name: '学生' }]);
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

    it('列表和详情只附带脱敏证件号，响应里没有明文', async () => {
      vi.spyOn(prisma.tenant, 'findMany').mockResolvedValue([{ id: 'tenant-1', name: '张三' }] as any);
      vi.spyOn(prisma.tenant, 'count').mockResolvedValue(1);
      vi.spyOn(prisma.tenantRegistration, 'findMany').mockResolvedValue([
        { tenantId: 'tenant-1', idNumber: 'v1:cipher' },
      ] as any);
      crypto.maskStored.mockReturnValue('4401**********1234');

      const listed = await service.findAll({ page: 1, limit: 20 });
      expect(listed.data[0].idNumberMasked).toBe('4401**********1234');
      expect(JSON.stringify(listed)).not.toContain('v1:cipher');

      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-1', name: '张三' } as any);
      const detail = await service.findOne('tenant-1');
      expect(detail.idNumberMasked).toBe('4401**********1234');
      expect(JSON.stringify(detail)).not.toContain('v1:cipher');
    });

    it('查看明文写 VIEW_ID_NUMBER，审计内容不含证件号', async () => {
      vi.spyOn(prisma.tenantRegistration, 'findUnique').mockResolvedValue({
        id: 'reg-1',
        idType: 'ID_CARD',
        idNumber: 'v1:cipher',
      } as any);
      crypto.decrypt.mockReturnValue('440101199001011234');

      const result = await service.revealIdNumber('tenant-1', {
        userId: 'admin-1',
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });

      expect(result).toEqual({ idNumber: '440101199001011234', idType: 'ID_CARD' });
      expect(auditLog.log).toHaveBeenCalledWith({
        userId: 'admin-1',
        action: 'VIEW_ID_NUMBER',
        entityType: 'TenantRegistration',
        entityId: 'reg-1',
        changes: { tenantId: 'tenant-1' },
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });
      expect(JSON.stringify(auditLog.log.mock.calls[0][0].changes)).not.toContain('440101199001011234');
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

  describe('居住登记与证件号（T271）', () => {
    const idNumber = '440101199001011234';
    const baseDto = {
      name: '张三',
      phone: '13800138000',
      email: 'zhangsan@example.com',
    };

    it('创建租客时同事务写入加密登记，响应只返回脱敏值', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.tenantRegistration, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.tenant, 'create').mockResolvedValue({ id: 'tenant-1', ...baseDto } as any);
      vi.spyOn(prisma.tenantRegistration, 'create').mockResolvedValue({} as any);

      const result = await service.create({
        ...baseDto,
        idType: 'ID_CARD' as any,
        idNumber,
      });

      expect(prisma.tenantRegistration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          idType: 'ID_CARD',
          idNumber: `enc:${idNumber}`,
          idNumberHash: `hash:${idNumber}`,
        }),
      });
      expect(result.idNumberMasked).toBe(`masked:enc:${idNumber}`);
      expect(result).not.toHaveProperty('idNumber');
      expect(crypto.encrypt).toHaveBeenCalledWith(idNumber);
    });

    it('证件号已登记在其它租客名下 → 409 且不建租客', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue(null);
      (prisma as any).tenantRegistration.findUnique.mockResolvedValue({ tenantId: 'other' });

      await expect(
        service.create({ ...baseDto, idType: 'ID_CARD' as any, idNumber }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.tenant.create).not.toHaveBeenCalled();
    });

    it('证件类型与号码不成对 → 400', async () => {
      await expect(service.create({ ...baseDto, idNumber } as any)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.create({ ...baseDto, idType: 'ID_CARD' as any } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('更新租客证件号：写登记 upsert 并记录不改值的审计', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-1', ...baseDto } as any);
      (prisma as any).tenantRegistration.findUnique
        .mockResolvedValueOnce({ tenantId: 'tenant-1', idType: 'ID_CARD', status: 'NOT_REGISTERED' })
        .mockResolvedValueOnce(null);
      vi.spyOn(prisma.tenant, 'update').mockResolvedValue({ id: 'tenant-1', ...baseDto } as any);
      (prisma as any).tenantRegistration.upsert.mockResolvedValue({});

      const result = await service.update(
        'tenant-1',
        { idNumber, idType: 'ID_CARD' as any },
        { userId: 'admin-1', ip: '127.0.0.1', userAgent: 'vitest' },
      );

      expect((prisma as any).tenantRegistration.upsert).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        create: expect.objectContaining({ idNumber: `enc:${idNumber}` }),
        update: expect.objectContaining({ idNumber: `enc:${idNumber}` }),
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_TENANT_REGISTRATION',
          changes: expect.objectContaining({ changedFields: ['idNumber', 'idType'] }),
        }),
      );
      expect(JSON.stringify(auditLog.log.mock.calls)).not.toContain(idNumber);
      expect(result.idNumberMasked).toBe(`masked:enc:${idNumber}`);
    });

    it('首次登记必须带证件号', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-1' } as any);
      (prisma as any).tenantRegistration.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertRegistration(
          'tenant-1',
          { idType: 'ID_CARD' as any, status: 'REGISTERED' as any },
          { userId: 'admin-1', ip: '', userAgent: '' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('状态只改进不退：REGISTERED → NOT_REGISTERED 抛 409', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-1' } as any);
      (prisma as any).tenantRegistration.findUnique.mockResolvedValue({
        tenantId: 'tenant-1',
        idType: 'ID_CARD',
        status: 'REGISTERED',
      });

      await expect(
        service.upsertRegistration(
          'tenant-1',
          { idType: 'ID_CARD' as any, status: 'NOT_REGISTERED' as any },
          { userId: 'admin-1', ip: '', userAgent: '' },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('只改状态：不要求证件号，写 registeredAt 与审计', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-1' } as any);
      (prisma as any).tenantRegistration.findUnique.mockResolvedValue({
        tenantId: 'tenant-1',
        idType: 'ID_CARD',
        idNumber: 'enc:old',
        idNumberHash: 'hash:old',
        status: 'PENDING',
        registeredAt: null,
      });
      (prisma as any).tenantRegistration.update.mockResolvedValue({
        id: 'reg-1',
        tenantId: 'tenant-1',
        idType: 'ID_CARD',
        idNumber: 'enc:old',
        status: 'REGISTERED',
        registeredAt: new Date('2026-10-24T00:00:00Z'),
        notes: null,
      });

      const result = await service.upsertRegistration(
        'tenant-1',
        { idType: 'ID_CARD' as any, status: 'REGISTERED' as any },
        { userId: 'admin-1', ip: '', userAgent: '' },
      );

      expect(result).toMatchObject({ status: 'REGISTERED', idNumberMasked: 'masked:enc:old' });
      expect((prisma as any).tenantRegistration.update).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        data: expect.objectContaining({ status: 'REGISTERED', registeredAt: expect.any(Date) }),
      });
      expect((prisma as any).auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'UPDATE_TENANT_REGISTRATION',
          entityId: 'reg-1',
          changes: expect.objectContaining({ status: 'REGISTERED', changedFields: ['status'] }),
        }),
      });
      expect(JSON.stringify((prisma as any).auditLog.create.mock.calls)).not.toContain('enc:old');
    });

    it('getRegistration 无登记 → 404；有登记只返回脱敏值', async () => {
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ id: 'tenant-1' } as any);
      (prisma as any).tenantRegistration.findUnique.mockResolvedValueOnce(null);
      await expect(service.getRegistration('tenant-1')).rejects.toThrow(NotFoundException);

      (prisma as any).tenantRegistration.findUnique.mockResolvedValueOnce({
        tenantId: 'tenant-1',
        idType: 'ID_CARD',
        idNumber: 'enc:x',
        status: 'REGISTERED',
        registeredAt: new Date('2026-10-24T00:00:00Z'),
        notes: null,
      });
      const view = await service.getRegistration('tenant-1');
      expect(view.idNumberMasked).toBe('masked:enc:x');
      expect(view).not.toHaveProperty('idNumber');
    });
  });
});
