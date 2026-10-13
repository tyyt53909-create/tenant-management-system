import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { InviteCodeService } from './invite-code.service.js';
import { JwtAuthService } from './jwt.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
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
            generateInviteCode: vi.fn(),
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

  /** 桩事务：返回可断言的 tenant.create 与 user.update（注册路径共用） */
  function stubTransaction(userId: string) {
    const tenantCreate = vi.fn().mockResolvedValue({});
    // 注册成功后会在同事务内清空邀请码（一次性语义，docs/03 §4.1）
    const invitedByUpdate = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) =>
      callback({
        user: {
          create: vi.fn().mockResolvedValue({
            id: userId,
            email: 'stub@example.com',
            role: 'TENANT',
            passwordHash: '$2b$10$stubhashstubhashstubhash',
          }),
          update: invitedByUpdate,
        },
        tenant: { create: tenantCreate },
      }),
    );
    return { tenantCreate, invitedByUpdate };
  }

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
            update: vi.fn().mockResolvedValue({}),
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

    it('连续注册两个不带 phone 的租客：都成功，占位手机号互不相同（BUG-1）', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const { tenantCreate: firstTenantCreate } = stubTransaction('user-a');
      const first = await controller.register({
        email: 'a@example.com',
        password: 'password123',
        inviteCode: 'INVITE-1',
      });

      const { tenantCreate: secondTenantCreate } = stubTransaction('user-b');
      const second = await controller.register({
        email: 'b@example.com',
        password: 'password123',
        inviteCode: 'INVITE-1',
      });

      expect(first.user.id).toBe('user-a');
      expect(second.user.id).toBe('user-b');

      const firstPhone = firstTenantCreate.mock.calls[0][0].data.phone;
      const secondPhone = secondTenantCreate.mock.calls[0][0].data.phone;
      // 不能写空串（Tenant.phone 唯一约束），且两次注册必须得到不同的值
      expect(firstPhone).toBe('pending-user-a');
      expect(secondPhone).toBe('pending-user-b');
      expect(firstPhone).not.toBe(secondPhone);
      expect(firstPhone).not.toBe('');
    });

    it('注册成功后立即清空邀请码（一次性，docs/03 §4.1）', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const { invitedByUpdate } = stubTransaction('user-invite');
      await controller.register({ ...dto, inviteCode: 'INVITE-ONCE' });

      expect(invitedByUpdate).toHaveBeenCalledTimes(1);
      const call = invitedByUpdate.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'admin-123' });
      expect(call.data).toEqual({ inviteCode: null, inviteExpiredAt: null });
    });

    it('提供 phone 时按用户输入写入租客档案', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const { tenantCreate } = stubTransaction('user-c');
      await controller.register({ ...dto, phone: '13800138000' });

      expect(tenantCreate.mock.calls[0][0].data.phone).toBe('13800138000');
    });

    it('注册响应不得泄露 passwordHash（BUG-1 顺带确认）', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      stubTransaction('user-d'); // 仅需桩事务存在

      const result = await controller.register(dto);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain('passwordHash');
      expect(serialized).not.toContain('$2b$');
      expect(Object.keys(result.user).sort()).toEqual(['email', 'id', 'role']);
    });
  });

  describe('generateInviteCode（T148 / BUG-2）', () => {
    const adminReq = { user: { userId: 'admin-1', role: 'ADMIN' } };

    it('管理员生成邀请码：复用 InviteCodeService.generateInviteCode', async () => {
      vi.spyOn(inviteCodeService, 'generateInviteCode').mockResolvedValue('INVITE-abc123');

      const result = await controller.generateInviteCode(adminReq, { expiryDays: 30 } as any);

      expect(result.inviteCode).toBe('INVITE-abc123');
      expect(result.expiryDays).toBe(30);
      expect(result.invitedBy).toBe('admin-1');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(inviteCodeService.generateInviteCode).toHaveBeenCalledWith('admin-1', 30);
    });

    it('未指定有效期时默认 365 天', async () => {
      vi.spyOn(inviteCodeService, 'generateInviteCode').mockResolvedValue('INVITE-def456');

      const result = await controller.generateInviteCode(adminReq, {} as any);

      expect(result.expiryDays).toBe(365);
      expect(inviteCodeService.generateInviteCode).toHaveBeenCalledWith('admin-1', 365);
    });

    it('生成的邀请码可直接用于注册', async () => {
      vi.spyOn(inviteCodeService, 'generateInviteCode').mockResolvedValue('INVITE-new');
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockImplementation(async (code: string) =>
        code === 'INVITE-new' ? { valid: true, invitedBy: 'admin-1' } : { valid: false },
      );
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      stubTransaction('user-e');

      const generated = await controller.generateInviteCode(adminReq, {} as any);
      const registered = await controller.register({
        email: 'invited@example.com',
        password: 'password123',
        inviteCode: generated.inviteCode,
      });

      expect(registered.accessToken).toBe('access-token');
      expect(registered.user.email).toBe('stub@example.com');
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
