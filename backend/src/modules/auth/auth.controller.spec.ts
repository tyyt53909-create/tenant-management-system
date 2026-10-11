import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { InviteCodeService } from './invite-code.service';
import { JwtAuthService } from './jwt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import * as bcrypt from 'bcrypt';

describe('AuthController', () => {
  let controller: AuthController;
  let inviteCodeService: InviteCodeService;
  let jwtService: JwtAuthService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: InviteCodeService,
          useValue: {
            validateInviteCode: vi.fn(),
          },
        },
        {
          provide: JwtAuthService,
          useValue: {
            generateTokens: vi.fn(),
            verifyToken: vi.fn(),
            refreshAccessToken: vi.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            tenant: {
              create: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    inviteCodeService = module.get<InviteCodeService>(InviteCodeService);
    jwtService = module.get<JwtAuthService>(JwtAuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('应该定义控制器', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    const dto: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      inviteCode: 'INVITE-123',
    };

    it('应该成功注册用户', async () => {
      const mockUser = {
        id: 'user-123',
        email: dto.email,
        role: 'TENANT',
      };

      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          user: {
            create: vi.fn().mockResolvedValue(mockUser),
          },
          tenant: {
            create: vi.fn().mockResolvedValue({}),
          },
        });
      });
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const result = await controller.register(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.user.id).toBe('user-123');
    });

    it('应该拒绝无效的邀请码', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: false,
      });

      await expect(controller.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('应该拒绝已注册的邮箱', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: 'existing-user',
      } as any);

      await expect(controller.register(dto)).rejects.toThrow(ConflictException);
    });

    it('应该拒绝已注册的手机号', async () => {
      const dtoWithPhone = { ...dto, phone: '13800138000' };

      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      // 第一次调用（检查邮箱）返回 null
      vi.spyOn(prisma.user, 'findUnique')
        .mockResolvedValueOnce(null)
        // 第二次调用（检查手机号）返回已存在用户
        .mockResolvedValueOnce({
          id: 'existing-user',
        } as any);

      await expect(controller.register(dtoWithPhone)).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    const dto: LoginDto = {
      identifier: 'test@example.com',
      password: 'password123',
    };

    it('应该成功登录（使用邮箱）', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        phone: '13800138000',
        passwordHash: await bcrypt.hash('password123', 10),
        role: 'TENANT',
        isActive: true,
      };

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);
      vi.spyOn(prisma.user, 'update').mockResolvedValue(mockUser as any);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const result = await controller.login(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.user.email).toBe('test@example.com');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('应该成功登录（使用手机号）', async () => {
      const dtoWithPhone = {
        identifier: '13800138000',
        password: 'password123',
      };

      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        phone: '13800138000',
        passwordHash: await bcrypt.hash('password123', 10),
        role: 'TENANT',
        isActive: true,
      };

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);
      vi.spyOn(prisma.user, 'update').mockResolvedValue(mockUser as any);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const result = await controller.login(dtoWithPhone);

      expect(result.accessToken).toBe('access-token');
      expect(result.user.phone).toBe('13800138000');
    });

    it('应该拒绝不存在的用户', async () => {
      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);

      await expect(controller.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('应该拒绝密码错误', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        phone: null,
        passwordHash: await bcrypt.hash('correct-password', 10),
        role: 'TENANT',
        isActive: true,
      };

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);

      await expect(controller.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('应该拒绝已禁用的用户', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        phone: null,
        passwordHash: await bcrypt.hash('password123', 10),
        role: 'TENANT',
        isActive: false,
      };

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);

      await expect(controller.login(dto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('refresh', () => {
    const dto: RefreshTokenDto = {
      refreshToken: 'valid-refresh-token',
    };

    it('应该成功刷新 Token', async () => {
      const mockUser = {
        id: 'user-123',
        role: 'TENANT',
        isActive: true,
      };

      vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
        sub: 'user-123',
        role: 'TENANT',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);
      vi.spyOn(jwtService, 'refreshAccessToken').mockResolvedValue('new-access-token');

      const result = await controller.refresh(dto);

      expect(result.accessToken).toBe('new-access-token');
      expect(jwtService.verifyToken).toHaveBeenCalledWith(dto.refreshToken);
      expect(jwtService.refreshAccessToken).toHaveBeenCalledWith(
        dto.refreshToken,
        { sub: 'user-123', role: 'TENANT' },
      );
    });

    it('应该拒绝无效的 Refresh Token', async () => {
      vi.spyOn(jwtService, 'verifyToken').mockRejectedValue(new Error('Invalid token'));

      await expect(controller.refresh(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('应该拒绝不存在的用户', async () => {
      vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
        sub: 'user-123',
        role: 'TENANT',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      await expect(controller.refresh(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('应该拒绝已禁用的用户', async () => {
      const mockUser = {
        id: 'user-123',
        role: 'TENANT',
        isActive: false,
      };

      vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
        sub: 'user-123',
        role: 'TENANT',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);

      await expect(controller.refresh(dto)).rejects.toThrow(ForbiddenException);
    });
  });
});
