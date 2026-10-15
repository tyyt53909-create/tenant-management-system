import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { InviteCodeService } from './invite-code.service.js';
import { JwtAuthService } from './jwt.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { GoogleAuthService } from './google-auth.service.js';
import { EmailOtpService } from './email-otp.service.js';
import * as bcrypt from 'bcrypt';

describe('AuthController', () => {
  let controller: AuthController;
  let inviteCodeService: InviteCodeService;
  let jwtService: JwtAuthService;
  let googleAuthService: GoogleAuthService;
  let emailOtpService: EmailOtpService;
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
          provide: GoogleAuthService,
          useValue: {
            getClientId: vi.fn().mockReturnValue('test-google-client-id'),
            verifyIdToken: vi.fn(),
          },
        },
        {
          provide: EmailOtpService,
          useValue: {
            sendCode: vi.fn(),
            verifyCode: vi.fn(),
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
              findFirst: vi.fn(),
              update: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    inviteCodeService = module.get<InviteCodeService>(InviteCodeService);
    jwtService = module.get<JwtAuthService>(JwtAuthService);
    googleAuthService = module.get<GoogleAuthService>(GoogleAuthService);
    emailOtpService = module.get<EmailOtpService>(EmailOtpService);
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
        tokenType: 'REFRESH',
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

    it('禁止使用 Access Token 刷新 Token', async () => {
      vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
        sub: 'user-123',
        role: 'TENANT',
        tokenType: 'ACCESS',
      });

      await expect(controller.refresh(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('应该拒绝无效的 Refresh Token', async () => {
      vi.spyOn(jwtService, 'verifyToken').mockRejectedValue(new Error('Invalid token'));

      await expect(controller.refresh(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('应该拒绝不存在的用户', async () => {
      vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
        sub: 'user-123',
        role: 'TENANT',
        tokenType: 'REFRESH',
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
        tokenType: 'REFRESH',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);

      await expect(controller.refresh(dto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('googleAuth & google/client-id', () => {
    it('应该能正常获取 Google Client ID', () => {
      expect(controller.getGoogleClientId()).toEqual({ clientId: 'test-google-client-id' });
    });

    it('已有用户使用 Google 登录：匹配邮箱并自动关联 googleId', async () => {
      const mockUser = {
        id: 'user-google-1',
        email: 'tenant_existing@gmail.com',
        phone: '13800000000',
        role: 'TENANT',
        googleId: null,
        avatarUrl: null,
        isActive: true,
      };

      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue({
        googleId: 'google-sub-12345',
        email: 'tenant_existing@gmail.com',
        name: 'Existing Tenant',
        avatarUrl: 'https://avatar.com/photo.jpg',
        emailVerified: true,
      });

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);
      vi.spyOn(prisma.user, 'update').mockResolvedValue({
        ...mockUser,
        googleId: 'google-sub-12345',
        avatarUrl: 'https://avatar.com/photo.jpg',
      } as any);

      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'google-jwt-access',
        refreshToken: 'google-jwt-refresh',
      });

      const res = await controller.googleAuth({ idToken: 'valid-google-id-token' });

      expect(res.accessToken).toBe('google-jwt-access');
      expect(res.user.email).toBe('tenant_existing@gmail.com');
      expect(prisma.user.update).toHaveBeenCalled();
      expect(res.isNewUser).toBe(false);
    });

    it('禁用账号使用 Google 登录应该抛出 ForbiddenException', async () => {
      const mockUser = {
        id: 'user-google-banned',
        email: 'banned@gmail.com',
        role: 'TENANT',
        isActive: false,
      };

      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue({
        googleId: 'google-sub-banned',
        email: 'banned@gmail.com',
        emailVerified: true,
      });

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);

      await expect(controller.googleAuth({ idToken: 'banned-token' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('新用户首次 Google 登录未提供邀请码亦可零门槛自动注册并登录', async () => {
      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue({
        googleId: 'google-sub-new',
        email: 'newuser@gmail.com',
        name: 'New Tenant',
        avatarUrl: 'https://avatar.com/new.jpg',
        emailVerified: true,
      });

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);

      const mockCreatedUser = {
        id: 'user-new-created',
        email: 'newuser@gmail.com',
        phone: null,
        role: 'TENANT',
        avatarUrl: 'https://avatar.com/new.jpg',
        isActive: true,
      };

      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          user: {
            create: vi.fn().mockResolvedValue(mockCreatedUser),
            update: vi.fn().mockResolvedValue({}),
          },
          tenant: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          },
        });
      });

      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'new-jwt-access',
        refreshToken: 'new-jwt-refresh',
      });

      const res = await controller.googleAuth({ idToken: 'new-user-token' });

      expect(res.accessToken).toBe('new-jwt-access');
      expect(res.isNewUser).toBe(true);
      expect(res.user.email).toBe('newuser@gmail.com');
    });

    it('新用户首次 Google 登录携带有效邀请码成功注册并关联', async () => {
      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue({
        googleId: 'google-sub-new',
        email: 'newuser@gmail.com',
        name: 'New Tenant',
        avatarUrl: 'https://avatar.com/new.jpg',
        emailVerified: true,
      });

      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-id',
      });

      const mockCreatedUser = {
        id: 'user-new-created',
        email: 'newuser@gmail.com',
        phone: null,
        role: 'TENANT',
        avatarUrl: 'https://avatar.com/new.jpg',
        isActive: true,
      };

      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          user: {
            create: vi.fn().mockResolvedValue(mockCreatedUser),
            update: vi.fn().mockResolvedValue({}),
          },
          tenant: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          },
        });
      });

      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'new-jwt-access',
        refreshToken: 'new-jwt-refresh',
      });

      const res = await controller.googleAuth({
        idToken: 'new-user-token',
        inviteCode: 'INVITE-VALID-123',
      });

      expect(res.accessToken).toBe('new-jwt-access');
      expect(res.isNewUser).toBe(true);
      expect(res.user.email).toBe('newuser@gmail.com');
    });
  });

  describe('Email OTP & Delayed Binding (T170)', () => {
    describe('sendEmailCode', () => {
      it('发送邮箱验证码成功应返回冷却时间', async () => {
        vi.spyOn(emailOtpService, 'sendCode').mockResolvedValue({ cooldown: 60 });

        const res = await controller.sendEmailCode({ email: 'tenant@example.com' });
        expect(res.cooldown).toBe(60);
        expect(res.message).toContain('验证码已发送');
        expect(emailOtpService.sendCode).toHaveBeenCalledWith('tenant@example.com');
      });
    });

    describe('loginWithEmailCode', () => {
      it('验证码错误应抛出 BadRequestException', async () => {
        vi.spyOn(emailOtpService, 'verifyCode').mockReturnValue(false);

        await expect(
          controller.loginWithEmailCode({ email: 'test@example.com', code: '000000' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('账号被禁用应抛出 ForbiddenException', async () => {
        vi.spyOn(emailOtpService, 'verifyCode').mockReturnValue(true);
        vi.spyOn(prisma.user, 'findFirst').mockResolvedValue({
          id: 'user-banned',
          email: 'banned@example.com',
          isActive: false,
        } as any);

        await expect(
          controller.loginWithEmailCode({ email: 'banned@example.com', code: '123456' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('已有正常用户验证码登录成功', async () => {
        vi.spyOn(emailOtpService, 'verifyCode').mockReturnValue(true);
        const mockUser = {
          id: 'user-existing',
          email: 'exist@example.com',
          phone: '13900000000',
          role: 'TENANT',
          isActive: true,
          avatarUrl: null,
        };
        vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);
        vi.spyOn(prisma.user, 'update').mockResolvedValue(mockUser as any);
        vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
          accessToken: 'otp-access-token',
          refreshToken: 'otp-refresh-token',
        });

        const res = await controller.loginWithEmailCode({
          email: 'exist@example.com',
          code: '123456',
        });

        expect(res.accessToken).toBe('otp-access-token');
        expect(res.isNewUser).toBe(false);
        expect(res.user.email).toBe('exist@example.com');
        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: 'user-existing' },
          data: { lastLoginAt: expect.any(Date) },
        });
      });

      it('新用户验证码登录应自动创建账户与租客记录', async () => {
        vi.spyOn(emailOtpService, 'verifyCode').mockReturnValue(true);
        vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);

        const mockNewUser = {
          id: 'user-otp-new',
          email: 'newotp@example.com',
          phone: null,
          role: 'TENANT',
          isActive: true,
          avatarUrl: null,
        };

        vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
          return callback({
            user: {
              create: vi.fn().mockResolvedValue(mockNewUser),
            },
            tenant: {
              findFirst: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue({}),
            },
          });
        });

        vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
          accessToken: 'new-otp-access',
          refreshToken: 'new-otp-refresh',
        });

        const res = await controller.loginWithEmailCode({
          email: 'newotp@example.com',
          code: '123456',
        });

        expect(res.accessToken).toBe('new-otp-access');
        expect(res.isNewUser).toBe(true);
        expect(res.user.email).toBe('newotp@example.com');
      });
    });

    describe('bindInviteCode', () => {
      it('邀请码无效应抛出 BadRequestException', async () => {
        vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({ valid: false });

        await expect(
          controller.bindInviteCode({ user: { userId: 'u1' } }, { inviteCode: 'BADCODE' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('邀请码有效应在事务中清空码并更新 user.invitedBy', async () => {
        vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
          valid: true,
          invitedBy: 'admin-inviter',
        });

        const userUpdate = vi.fn().mockResolvedValue({});
        vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
          return callback({
            user: {
              update: userUpdate,
            },
          });
        });

        const res = await controller.bindInviteCode(
          { user: { userId: 'tenant-user-1' } },
          { inviteCode: 'GOODCODE' },
        );

        expect(res.success).toBe(true);
        expect(userUpdate).toHaveBeenCalledTimes(2);
        // 第一调用：使邀请码失效
        expect(userUpdate).toHaveBeenNthCalledWith(1, {
          where: { id: 'admin-inviter' },
          data: { inviteCode: null, inviteExpiredAt: null },
        });
        // 第二调用：关联用户
        expect(userUpdate).toHaveBeenNthCalledWith(2, {
          where: { id: 'tenant-user-1' },
          data: { invitedBy: 'admin-inviter' },
        });
      });
    });
  });
});

