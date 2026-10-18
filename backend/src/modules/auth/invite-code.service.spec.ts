import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InviteCodeService } from './invite-code.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('InviteCodeService', () => {
  let service: InviteCodeService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InviteCodeService,
        {
          provide: PrismaService,
          useValue: {
            inviteCode: {
              create: vi.fn(),
              createMany: vi.fn(),
              findUnique: vi.fn(),
              findMany: vi.fn(),
              update: vi.fn(),
              updateMany: vi.fn(),
              count: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<InviteCodeService>(InviteCodeService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('应该定义服务', () => {
    expect(service).toBeDefined();
  });

  describe('generateInviteCode', () => {
    it('应该生成单个邀请码并保存到数据库', async () => {
      const adminUserId = 'admin-123';
      const expiryDays = 30;

      vi.spyOn(prisma.inviteCode, 'create').mockResolvedValue({} as any);

      const code = await service.generateInviteCode(adminUserId, expiryDays, '测试备注', 'TENANT');

      expect(code).toMatch(/^INVITE-\d+-[A-Z0-9]{6}$/);
      expect(prisma.inviteCode.create).toHaveBeenCalledWith({
        data: {
          code: expect.any(String),
          role: 'TENANT',
          status: 'UNUSED',
          notes: '测试备注',
          creatorId: adminUserId,
          expiresAt: expect.any(Date),
        },
      });
    });
  });

  describe('generateBatchInviteCodes', () => {
    it('应该批量生成 N 个独立邀请码并使用 createMany', async () => {
      const adminUserId = 'admin-123';
      const count = 5;

      vi.spyOn(prisma.inviteCode, 'createMany').mockResolvedValue({ count: 5 });

      const codes = await service.generateBatchInviteCodes(adminUserId, count, 365, '批量生成');

      expect(codes).toHaveLength(5);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(5);
      expect(prisma.inviteCode.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            code: expect.stringMatching(/^INVITE-/),
            role: 'TENANT',
            status: 'UNUSED',
            notes: '批量生成',
            creatorId: adminUserId,
          }),
        ]),
      });
    });
  });

  describe('validateInviteCode', () => {
    it('应该验证有效的邀请码', async () => {
      const code = 'INVITE-123-ABC123';
      const mockRecord = {
        id: 'code-1',
        code,
        status: 'UNUSED',
        role: 'TENANT',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        creatorId: 'admin-123',
      };

      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue(mockRecord as any);

      const result = await service.validateInviteCode(code);

      expect(result.valid).toBe(true);
      expect(result.invitedBy).toBe('admin-123');
      expect(result.inviteCodeId).toBe('code-1');
      expect(result.role).toBe('TENANT');
    });

    it('应该拒绝无效参数或空字符串', async () => {
      const result = await service.validateInviteCode('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('INVALID_CODE');
    });

    it('应该拒绝不存在的邀请码', async () => {
      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue(null);

      const result = await service.validateInviteCode('INVALID');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NOT_FOUND');
    });

    it('应该抛出异常如果邀请码已被作废', async () => {
      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue({
        id: 'code-1',
        code: 'INVITE-REVOKED',
        status: 'REVOKED',
      } as any);

      await expect(service.validateInviteCode('INVITE-REVOKED')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('应该返回 ALREADY_USED 如果邀请码已核销', async () => {
      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue({
        id: 'code-1',
        code: 'INVITE-USED',
        status: 'USED',
      } as any);

      const result = await service.validateInviteCode('INVITE-USED');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ALREADY_USED');
    });

    it('应该抛出异常如果邀请码已过期', async () => {
      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue({
        id: 'code-1',
        code: 'INVITE-EXPIRED',
        status: 'UNUSED',
        expiresAt: new Date(Date.now() - 1000),
      } as any);

      await expect(service.validateInviteCode('INVITE-EXPIRED')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('consumeInviteCode', () => {
    it('应该原子更新邀请码状态为 USED 并记录使用者', async () => {
      vi.spyOn(prisma.inviteCode, 'updateMany').mockResolvedValue({ count: 1 });

      await service.consumeInviteCode('INVITE-VALID', 'user-tenant-1');

      expect(prisma.inviteCode.updateMany).toHaveBeenCalledWith({
        where: { code: 'INVITE-VALID', status: 'UNUSED' },
        data: {
          status: 'USED',
          usedById: 'user-tenant-1',
          usedAt: expect.any(Date),
        },
      });
    });
  });

  describe('hasValidInviteCode', () => {
    it('应该返回 true 当存在有效的未过期邀请码', async () => {
      vi.spyOn(prisma.inviteCode, 'count').mockResolvedValue(2);

      const result = await service.hasValidInviteCode('admin-123');

      expect(result).toBe(true);
    });

    it('应该返回 false 当不存在有效邀请码', async () => {
      vi.spyOn(prisma.inviteCode, 'count').mockResolvedValue(0);

      const result = await service.hasValidInviteCode('admin-123');

      expect(result).toBe(false);
    });
  });

  describe('findAll', () => {
    it('应该支持分页与过滤查询邀请码列表', async () => {
      const mockItems = [{ id: '1', code: 'INVITE-1' }];
      vi.spyOn(prisma.inviteCode, 'count').mockResolvedValue(1);
      vi.spyOn(prisma.inviteCode, 'findMany').mockResolvedValue(mockItems as any);

      const result = await service.findAll({ page: 1, limit: 10, status: 'UNUSED' });

      expect(result.data).toEqual(mockItems);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });
  });

  describe('revokeInviteCode', () => {
    it('应该成功作废 UNUSED 邀请码', async () => {
      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue({
        id: 'code-1',
        status: 'UNUSED',
      } as any);
      vi.spyOn(prisma.inviteCode, 'update').mockResolvedValue({
        id: 'code-1',
        status: 'REVOKED',
      } as any);

      const result = await service.revokeInviteCode('code-1');

      expect(result.status).toBe('REVOKED');
      expect(prisma.inviteCode.update).toHaveBeenCalledWith({
        where: { id: 'code-1' },
        data: { status: 'REVOKED' },
      });
    });

    it('应该抛出 NotFoundException 当邀请码不存在', async () => {
      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue(null);

      await expect(service.revokeInviteCode('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('应该抛出 BadRequestException 当邀请码已被使用', async () => {
      vi.spyOn(prisma.inviteCode, 'findUnique').mockResolvedValue({
        id: 'code-1',
        status: 'USED',
      } as any);

      await expect(service.revokeInviteCode('code-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
