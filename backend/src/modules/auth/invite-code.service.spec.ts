import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InviteCodeService } from './invite-code.service';
import { PrismaService } from '../prisma/prisma.service';

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
            user: {
              update: vi.fn(),
              findFirst: vi.fn(),
              findUnique: vi.fn(),
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
    it('应该生成邀请码', async () => {
      const userId = 'admin-123';
      const expiryDays = 365;

      vi.spyOn(prisma.user, 'update').mockResolvedValue({} as any);

      const inviteCode = await service.generateInviteCode(userId, expiryDays);

      expect(inviteCode).toMatch(/^INVITE-\d+-[A-Z0-9]{6}$/);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: {
          inviteCode: expect.any(String),
          inviteExpiredAt: expect.any(Date),
        },
      });
    });
  });

  describe('validateInviteCode', () => {
    it('应该验证有效的邀请码', async () => {
      const code = 'INVITE-123-ABC123';
      const mockUser = {
        id: 'user-123',
        inviteCode: code,
        inviteExpiredAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        role: 'ADMIN',
      };

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);

      const result = await service.validateInviteCode(code);

      expect(result.valid).toBe(true);
      expect(result.invitedBy).toBe('user-123');
    });

    it('应该拒绝不存在的邀请码', async () => {
      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);

      const result = await service.validateInviteCode('INVALID');

      expect(result.valid).toBe(false);
    });

    it('应该拒绝已过期的邀请码', async () => {
      const mockUser = {
        id: 'user-123',
        inviteCode: 'INVITE-123',
        inviteExpiredAt: new Date(Date.now() - 1000), // 已过期
        role: 'ADMIN',
      };

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);

      await expect(service.validateInviteCode('INVITE-123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('hasValidInviteCode', () => {
    it('应该返回 true 当邀请码有效', async () => {
      const mockUser = {
        inviteCode: 'INVITE-123',
        inviteExpiredAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);

      const result = await service.hasValidInviteCode('user-123');

      expect(result).toBe(true);
    });

    it('应该返回 false 当邀请码不存在', async () => {
      const mockUser = {
        inviteCode: null,
        inviteExpiredAt: null,
      };

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);

      const result = await service.hasValidInviteCode('user-123');

      expect(result).toBe(false);
    });

    it('应该返回 false 当邀请码已过期', async () => {
      const mockUser = {
        inviteCode: 'INVITE-123',
        inviteExpiredAt: new Date(Date.now() - 1000),
      };

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);

      const result = await service.hasValidInviteCode('user-123');

      expect(result).toBe(false);
    });
  });
});
