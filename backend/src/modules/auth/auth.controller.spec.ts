import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
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
import { TenantCapabilityService } from '../tenant-capabilities/tenant-capability.service.js';
import { AuthService } from './auth.service.js';
import * as bcrypt from 'bcrypt';
import { LOGIN_ATTEMPT_STORE, MemoryLoginAttemptStore } from './login-attempt.store.js';
import { FederatedAuthService } from './federated-auth.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  let inviteCodeService: InviteCodeService;
  let jwtService: JwtAuthService;
  let googleAuthService: GoogleAuthService;
  let emailOtpService: EmailOtpService;
  let tenantCapabilityService: TenantCapabilityService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: InviteCodeService,
          useValue: {
            validateInviteCode: vi.fn(),
            generateInviteCode: vi.fn(),
            generateBatchInviteCodes: vi.fn(),
            consumeInviteCode: vi.fn().mockResolvedValue(undefined),
            findAll: vi.fn(),
            revokeInviteCode: vi.fn(),
          },
        },
        {
          provide: JwtAuthService,
          useValue: {
            generateTokens: vi.fn(),
            verifyToken: vi.fn(),
            refreshAccessToken: vi.fn(),
            rotateRefreshToken: vi.fn(),
            revokeRefreshToken: vi.fn(),
            revokeUserSessions: vi.fn(),
          },
        },
        {
          provide: GoogleAuthService,
          useValue: {
            getClientId: vi.fn().mockReturnValue('test-google-client-id'),
            isMockEnabled: vi.fn().mockReturnValue(false),
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
          provide: TenantCapabilityService,
          useValue: {
            getEffectiveCapabilities: vi.fn().mockResolvedValue(['tenant.contract.read', 'tenant.bill.read']),
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
            userIdentity: {
              create: vi.fn(),
              upsert: vi.fn(),
              findFirst: vi.fn(),
            },
            tenant: {
              create: vi.fn(),
              findFirst: vi.fn(),
              findUnique: vi.fn(),
              update: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
        // QLT-02 / T288：登录失败计数与 FederatedAuthService 改为必填
        { provide: LOGIN_ATTEMPT_STORE, useValue: new MemoryLoginAttemptStore() },
        {
          // 用真实实现装配（与改动前 AuthService 内部 new 的行为一致），
          // 这样 Google / 邮箱验证码用例仍然验证真实业务分支。
          provide: FederatedAuthService,
          useFactory: (
            prisma: PrismaService,
            google: GoogleAuthService,
            otp: EmailOtpService,
            jwt: JwtAuthService,
            invite: InviteCodeService,
          ) => new FederatedAuthService(prisma, google, otp, jwt, invite),
          inject: [PrismaService, GoogleAuthService, EmailOtpService, JwtAuthService, InviteCodeService],
        },
        // Cookie 的 Secure 标志由 ConfigService 决定（生产环境 true）
        { provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'development' }) },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    inviteCodeService = module.get<InviteCodeService>(InviteCodeService);
    jwtService = module.get<JwtAuthService>(JwtAuthService);
    googleAuthService = module.get<GoogleAuthService>(GoogleAuthService);
    emailOtpService = module.get<EmailOtpService>(EmailOtpService);
    tenantCapabilityService = module.get<TenantCapabilityService>(TenantCapabilityService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  /** 桩事务：注册路径建 User + UserIdentity 并绑定预建 Tenant（DEC-03，不新建 Tenant） */
  function stubTransaction(userId: string) {
    const tenantUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const identityCreate = vi.fn().mockResolvedValue({});
    const invitedByUpdate = vi.fn().mockResolvedValue({});
    const userCreate = vi.fn().mockResolvedValue({
      id: userId,
      email: 'stub@example.com',
      role: 'TENANT',
      passwordHash: '$2b$10$stubhashstubhashstubhash',
    });
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) =>
      callback({
        user: {
          create: userCreate,
          update: invitedByUpdate,
        },
        userIdentity: {
          create: identityCreate,
          upsert: vi.fn().mockResolvedValue({}),
        },
        tenant: { updateMany: tenantUpdate, create: vi.fn().mockResolvedValue({}) },
      }),
    );
    return { tenantUpdate, identityCreate, invitedByUpdate, userCreate };
  }

  it('应该定义控制器', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    const dto: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      inviteCode: 'INVITE-123',
      emailCode: '654321',
    };

    beforeEach(() => {
      vi.spyOn(emailOtpService, 'verifyCode').mockResolvedValue(true);
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: 'tenant-pre',
        email: 'test@example.com',
        phone: null,
        userId: null,
      } as any);
    });

    function stubRegisterSuccess(userId = 'user-123', role = 'TENANT') {
      const tx = stubTransaction(userId);
      tx.userCreate.mockResolvedValue({
        id: userId,
        email: dto.email,
        role,
        passwordHash: '$2b$10$stubhashstubhashstubhash',
      });
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      return tx;
    }

    it('应该成功注册并绑定预建租客', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
        role: 'TENANT',
        tenantId: 'tenant-pre',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      const tx = stubRegisterSuccess();

      const result = await controller.register(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.user.id).toBe('user-123');
      expect(tx.tenantUpdate).toHaveBeenCalledWith({
        where: { id: 'tenant-pre', userId: null },
        data: { userId: 'user-123' },
      });
      expect(tx.identityCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ provider: 'EMAIL', providerUserId: dto.email }),
      });
    });

    it('邀请码 role 生效，不再硬编码 TENANT', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
        role: 'CLEANER',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      const tx = stubRegisterSuccess('user-cleaner', 'CLEANER');

      const result = await controller.register({
        ...dto,
        email: 'cleaner@example.com',
        inviteCode: 'INVITE-CLEANER',
      });

      expect(tx.userCreate.mock.calls[0][0].data.role).toBe('CLEANER');
      expect(result.user.role).toBe('CLEANER');
    });

    it('没有匹配的预建租客档案时拒绝注册（403）', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
        role: 'TENANT',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue(null);

      await expect(controller.register(dto)).rejects.toMatchObject({ status: 403 });
    });

    it('应该拒绝无效的邀请码', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: false,
      });

      await expect(controller.register(dto)).rejects.toMatchObject({ status: 409 });
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
      vi.spyOn(prisma.user, 'findUnique')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'existing-user',
        } as any);

      await expect(controller.register(dtoWithPhone)).rejects.toThrow(ConflictException);
    });

    it('注册成功后原子核销邀请码（一次性）', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
        role: 'TENANT',
        tenantId: 'tenant-pre',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      stubRegisterSuccess('user-invite');
      const consumeSpy = vi.spyOn(inviteCodeService, 'consumeInviteCode').mockResolvedValue(undefined as any);

      await controller.register({ ...dto, inviteCode: 'INVITE-ONCE' });

      expect(consumeSpy).toHaveBeenCalledWith('INVITE-ONCE', 'user-invite', expect.anything());
    });

    it('注册响应不得泄露 passwordHash', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
        role: 'TENANT',
        tenantId: 'tenant-pre',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      stubRegisterSuccess('user-d');

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
      expect(inviteCodeService.generateInviteCode).toHaveBeenCalledWith('admin-1', 30, undefined, 'TENANT', undefined);
    });

    it('未指定有效期时默认 365 天', async () => {
      vi.spyOn(inviteCodeService, 'generateInviteCode').mockResolvedValue('INVITE-def456');

      const result = await controller.generateInviteCode(adminReq, {} as any);

      expect(result.expiryDays).toBe(365);
      expect(inviteCodeService.generateInviteCode).toHaveBeenCalledWith('admin-1', 365, undefined, 'TENANT', undefined);
    });

    it('生成的邀请码可直接用于注册', async () => {
      vi.spyOn(inviteCodeService, 'generateInviteCode').mockResolvedValue('INVITE-new');
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockImplementation(async (code: string) =>
        code === 'INVITE-new'
          ? { valid: true, invitedBy: 'admin-1', role: 'TENANT' as const, tenantId: 'tenant-pre' }
          : { valid: false },
      );
      vi.spyOn(emailOtpService, 'verifyCode').mockResolvedValue(true);
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: 'tenant-pre',
        email: 'invited@example.com',
        phone: null,
        userId: null,
      } as any);
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      stubTransaction('user-e');

      const generated = await controller.generateInviteCode(adminReq, {} as any);
      const registered = await controller.register({
        email: 'invited@example.com',
        password: 'password123',
        inviteCode: generated.inviteCode!,
        emailCode: '654321',
      });

      expect(registered.accessToken).toBe('access-token');
      expect(registered.user.email).toBe('stub@example.com');
    });

    it('管理员批量生成邀请码：调用 generateBatchInviteCodes', async () => {
      vi.spyOn(inviteCodeService, 'generateBatchInviteCodes').mockResolvedValue(['INVITE-1', 'INVITE-2', 'INVITE-3']);

      const result = await controller.generateInviteCode(adminReq, { count: 3, expiryDays: 90, notes: '批量3个' } as any);

      expect(result.inviteCodes).toEqual(['INVITE-1', 'INVITE-2', 'INVITE-3']);
      expect(result.count).toBe(3);
      expect(result.expiryDays).toBe(90);
      expect(result.invitedBy).toBe('admin-1');
      expect(inviteCodeService.generateBatchInviteCodes).toHaveBeenCalledWith(
        'admin-1',
        3,
        90,
        '批量3个',
        'TENANT',
        undefined,
      );
    });

    it('管理员查询邀请码列表：调用 inviteCodeService.findAll', async () => {
      const mockResult = { data: [{ id: '1', code: 'INVITE-1' }], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } };
      vi.spyOn(inviteCodeService, 'findAll').mockResolvedValue(mockResult as any);

      const res = await controller.listInviteCodes({ page: 1, limit: 20, status: 'UNUSED' } as any);

      expect(res).toEqual(mockResult);
      expect(inviteCodeService.findAll).toHaveBeenCalledWith({ page: 1, limit: 20, status: 'UNUSED' });
    });

    it('管理员作废邀请码：调用 inviteCodeService.revokeInviteCode', async () => {
      const mockRevoked = { id: 'code-1', status: 'REVOKED' };
      vi.spyOn(inviteCodeService, 'revokeInviteCode').mockResolvedValue(mockRevoked as any);

      const res = await controller.revokeInviteCode(adminReq, 'code-1');

      expect(res).toEqual(mockRevoked);
      expect(inviteCodeService.revokeInviteCode).toHaveBeenCalledWith('code-1', 'admin-1');
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
      vi.spyOn(jwtService, 'rotateRefreshToken').mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      const result = await controller.refresh(dto);

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(jwtService.rotateRefreshToken).toHaveBeenCalledWith(dto.refreshToken);
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

    it('登出时撤销这枚 refresh token 所在的会话', async () => {
      vi.spyOn(jwtService, 'revokeRefreshToken').mockResolvedValue(undefined);

      await expect(controller.logout(dto)).resolves.toEqual({ message: '已登出' });
      expect(jwtService.revokeRefreshToken).toHaveBeenCalledWith(dto.refreshToken);
    });

    it('通过 HttpOnly Cookie 传递 Refresh Token 刷新成功并更新 Cookie', async () => {
      const mockUser = { id: 'user-123', role: 'TENANT', isActive: true };
      vi.spyOn(jwtService, 'verifyToken').mockResolvedValue({
        sub: 'user-123',
        role: 'TENANT',
        tokenType: 'REFRESH',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);
      vi.spyOn(jwtService, 'rotateRefreshToken').mockResolvedValue({
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
      });

      const mockReq = { cookies: { refresh_token: 'cookie-refresh-token' } } as any;
      const mockRes = { cookie: vi.fn(), clearCookie: vi.fn() } as any;

      const result = await controller.refresh({}, mockReq, mockRes);
      expect(result.accessToken).toBe('rotated-access');
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'rotated-refresh',
        expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
      );
    });

    it('Body 和 Cookie 均无 Refresh Token 时抛出 UnauthorizedException', async () => {
      const mockReq = { cookies: {} } as any;
      await expect(controller.refresh({}, mockReq)).rejects.toThrow(UnauthorizedException);
    });

    it('登出时清除 HttpOnly Cookie', async () => {
      vi.spyOn(jwtService, 'revokeRefreshToken').mockResolvedValue(undefined);
      const mockReq = { cookies: { refresh_token: 'cookie-refresh-token' } } as any;
      const mockRes = { clearCookie: vi.fn() } as any;

      await expect(controller.logout({}, mockReq, mockRes)).resolves.toEqual({ message: '已登出' });
      expect(jwtService.revokeRefreshToken).toHaveBeenCalledWith('cookie-refresh-token');
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
      );
    });

    it('登出所有设备时撤销该用户的全部会话并清除 Cookie', async () => {
      vi.spyOn(jwtService, 'revokeUserSessions').mockResolvedValue(undefined);
      const mockRes = { clearCookie: vi.fn() } as any;

      await expect(
        controller.logoutAll({ user: { userId: 'user-123' } }, mockRes),
      ).resolves.toEqual({
        message: '已登出所有设备',
      });
      expect(jwtService.revokeUserSessions).toHaveBeenCalledWith('user-123');
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
      );
    });
  });

  describe('googleAuth & google/client-id', () => {
    const googlePayload = {
      googleId: 'google-sub-12345',
      email: 'tenant_existing@gmail.com',
      name: 'Existing Tenant',
      avatarUrl: 'https://avatar.com/photo.jpg',
      emailVerified: true,
    };

    function stubGoogleTransaction(user: Record<string, unknown>) {
      const identityUpsert = vi.fn().mockResolvedValue({});
      const identityCreate = vi.fn().mockResolvedValue({});
      const userUpdate = vi.fn().mockResolvedValue(user);
      const tenantUpdate = vi.fn().mockResolvedValue({ count: 1 });
      const userCreate = vi.fn().mockResolvedValue(user);
      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) =>
        callback({
          user: { create: userCreate, update: userUpdate },
          userIdentity: { create: identityCreate, upsert: identityUpsert },
          tenant: { updateMany: tenantUpdate, create: vi.fn().mockResolvedValue({}) },
        }),
      );
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'google-jwt-access',
        refreshToken: 'google-jwt-refresh',
      });
      return { identityUpsert, identityCreate, userUpdate, tenantUpdate, userCreate };
    }

    it('应该能正常获取 Google Client ID', () => {
      expect(controller.getGoogleClientId()).toEqual({
        clientId: 'test-google-client-id',
        mockEnabled: false,
      });
    });

    it('已有用户使用 Google 登录：补建身份并更新登录信息', async () => {
      const mockUser = {
        id: 'user-google-1',
        email: googlePayload.email,
        phone: '13800000000',
        role: 'TENANT',
        googleId: null,
        avatarUrl: null,
        isActive: true,
        emailVerifiedAt: null,
      };

      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue(googlePayload);
      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);
      const tx = stubGoogleTransaction({
        ...mockUser,
        googleId: googlePayload.googleId,
        avatarUrl: googlePayload.avatarUrl,
      });

      const res = await controller.googleAuth({ idToken: 'valid-google-id-token' });

      expect(res.accessToken).toBe('google-jwt-access');
      expect(res.user.email).toBe(googlePayload.email);
      expect(res.isNewUser).toBe(false);
      expect(tx.identityUpsert).toHaveBeenCalled();
      expect(tx.userUpdate).toHaveBeenCalled();
    });

    it('禁用账号使用 Google 登录应该抛出 ForbiddenException', async () => {
      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue(googlePayload);
      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue({
        id: 'user-google-banned',
        email: googlePayload.email,
        role: 'TENANT',
        isActive: false,
      } as any);

      await expect(controller.googleAuth({ idToken: 'banned-token' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('新用户未带邀请码时拒绝登录（403），不创建任何档案', async () => {
      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue({
        ...googlePayload,
        email: 'newuser@gmail.com',
      });
      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
      const txSpy = vi.spyOn(prisma, '$transaction');

      await expect(controller.googleAuth({ idToken: 'new-user-token' })).rejects.toMatchObject({
        status: 403,
      });
      expect(txSpy).not.toHaveBeenCalled();
    });

    it('新用户有邀请码但没有预建租客时拒绝（403）', async () => {
      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue({
        ...googlePayload,
        email: 'newuser@gmail.com',
      });
      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-id',
        role: 'TENANT',
      });
      vi.spyOn(prisma.tenant, 'findFirst').mockResolvedValue(null);

      await expect(
        controller.googleAuth({ idToken: 'new-user-token', inviteCode: 'INVITE-VALID-123' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('新用户携带有效邀请码且存在预建租客时成功注册并绑定', async () => {
      const mockCreatedUser = {
        id: 'user-new-created',
        email: 'newuser@gmail.com',
        phone: null,
        role: 'TENANT',
        avatarUrl: googlePayload.avatarUrl,
        isActive: true,
      };

      vi.spyOn(googleAuthService, 'verifyIdToken').mockResolvedValue({
        ...googlePayload,
        email: 'newuser@gmail.com',
      });
      vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-id',
        role: 'TENANT',
        tenantId: 'tenant-pre',
      });
      vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
        id: 'tenant-pre',
        email: 'newuser@gmail.com',
        phone: null,
        userId: null,
      } as any);
      const consumeSpy = vi
        .spyOn(inviteCodeService, 'consumeInviteCode')
        .mockResolvedValue(undefined as any);
      const tx = stubGoogleTransaction(mockCreatedUser);

      const res = await controller.googleAuth({
        idToken: 'new-user-token',
        inviteCode: 'INVITE-VALID-123',
      });

      expect(res.accessToken).toBe('google-jwt-access');
      expect(res.isNewUser).toBe(true);
      expect(res.user.email).toBe('newuser@gmail.com');
      expect(tx.identityCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ provider: 'GOOGLE', providerUserId: googlePayload.googleId }),
      });
      expect(tx.tenantUpdate).toHaveBeenCalledWith({
        where: { id: 'tenant-pre', userId: null },
        data: { userId: 'user-new-created' },
      });
      expect(consumeSpy).toHaveBeenCalledWith(
        'INVITE-VALID-123',
        'user-new-created',
        expect.anything(),
      );
    });
  });

  describe('Email OTP & Delayed Binding (T170)', () => {
    function stubOtpTransaction(user: Record<string, unknown>, hasTenant = true) {
      const identityUpsert = vi.fn().mockResolvedValue({});
      const identityCreate = vi.fn().mockResolvedValue({});
      const userUpdate = vi.fn().mockResolvedValue(user);
      const tenantUpdate = vi.fn().mockResolvedValue({ count: 1 });
      const userCreate = vi.fn().mockResolvedValue(user);
      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) =>
        callback({
          user: { create: userCreate, update: userUpdate },
          userIdentity: { create: identityCreate, upsert: identityUpsert },
          tenant: {
            updateMany: tenantUpdate,
            create: vi.fn().mockResolvedValue({}),
            findFirst: vi.fn().mockResolvedValue(hasTenant ? { id: 'tenant-1' } : null),
          },
        }),
      );
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'otp-access-token',
        refreshToken: 'otp-refresh-token',
      });
      return { identityUpsert, identityCreate, userUpdate, tenantUpdate, userCreate };
    }

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
        vi.spyOn(emailOtpService, 'verifyCode').mockResolvedValue(false);

        await expect(
          controller.loginWithEmailCode({ email: 'test@example.com', code: '000000' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('账号被禁用应抛出 ForbiddenException', async () => {
        vi.spyOn(emailOtpService, 'verifyCode').mockResolvedValue(true);
        vi.spyOn(prisma.user, 'findFirst').mockResolvedValue({
          id: 'user-banned',
          email: 'banned@example.com',
          isActive: false,
        } as any);

        await expect(
          controller.loginWithEmailCode({ email: 'banned@example.com', code: '123456' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('已有正常用户验证码登录成功并刷新 EMAIL 身份', async () => {
        vi.spyOn(emailOtpService, 'verifyCode').mockResolvedValue(true);
        const mockUser = {
          id: 'user-existing',
          email: 'exist@example.com',
          phone: '13900000000',
          role: 'TENANT',
          isActive: true,
          avatarUrl: null,
          emailVerifiedAt: null,
        };
        vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(mockUser as any);
        const tx = stubOtpTransaction(mockUser);

        const res = await controller.loginWithEmailCode({
          email: 'exist@example.com',
          code: '123456',
        });

        expect(res.accessToken).toBe('otp-access-token');
        expect(res.isNewUser).toBe(false);
        expect(res.user.email).toBe('exist@example.com');
        expect(tx.identityUpsert).toHaveBeenCalledWith({
          where: {
            provider_providerUserId: {
              provider: 'EMAIL',
              providerUserId: 'exist@example.com',
            },
          },
          create: expect.objectContaining({ provider: 'EMAIL' }),
          update: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
        });
      });

      it('新用户未带邀请码时拒绝登录（403），不自动建号', async () => {
        vi.spyOn(emailOtpService, 'verifyCode').mockResolvedValue(true);
        vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
        const txSpy = vi.spyOn(prisma, '$transaction');

        await expect(
          controller.loginWithEmailCode({ email: 'newotp@example.com', code: '123456' }),
        ).rejects.toMatchObject({ status: 403 });
        expect(txSpy).not.toHaveBeenCalled();
      });

      it('新用户带邀请码且存在预建租客时成功注册并绑定', async () => {
        const mockNewUser = {
          id: 'user-otp-new',
          email: 'newotp@example.com',
          phone: null,
          role: 'TENANT',
          isActive: true,
          avatarUrl: null,
        };
        vi.spyOn(emailOtpService, 'verifyCode').mockResolvedValue(true);
        vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
        vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
          valid: true,
          invitedBy: 'admin-id',
          role: 'TENANT',
          tenantId: 'tenant-pre',
        });
        vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
          id: 'tenant-pre',
          email: 'newotp@example.com',
          phone: null,
          userId: null,
        } as any);
        const consumeSpy = vi
          .spyOn(inviteCodeService, 'consumeInviteCode')
          .mockResolvedValue(undefined as any);
        const tx = stubOtpTransaction(mockNewUser);

        const res = await controller.loginWithEmailCode({
          email: 'newotp@example.com',
          code: '123456',
          inviteCode: 'INVITE-OTP',
        });

        expect(res.accessToken).toBe('otp-access-token');
        expect(res.isNewUser).toBe(true);
        expect(res.user.email).toBe('newotp@example.com');
        expect(tx.tenantUpdate).toHaveBeenCalledWith({
          where: { id: 'tenant-pre', userId: null },
          data: { userId: 'user-otp-new' },
        });
        expect(consumeSpy).toHaveBeenCalledWith('INVITE-OTP', 'user-otp-new', expect.anything());
      });
    });

    describe('bindInviteCode', () => {
      it('邀请码无效应抛出 BadRequestException', async () => {
        vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({ valid: false });

        await expect(
          controller.bindInviteCode({ user: { userId: 'u1' } }, { inviteCode: 'BADCODE' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('邀请码有效应在事务中核销码并更新角色与邀请人', async () => {
        vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
          valid: true,
          invitedBy: 'admin-inviter',
          role: 'CLEANER',
        });
        vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
          id: 'tenant-user-1',
          email: 'tenant@example.com',
          phone: '13800138000',
          role: 'TENANT',
          emailVerifiedAt: new Date(),
          tenant: { id: 'tenant-1' },
        } as any);
        const consumeSpy = vi
          .spyOn(inviteCodeService, 'consumeInviteCode')
          .mockResolvedValue(undefined as any);

        const userUpdate = vi.fn().mockResolvedValue({});
        vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) =>
          callback({
            user: { update: userUpdate },
            tenant: { update: vi.fn().mockResolvedValue({}) },
          }),
        );

        const res = await controller.bindInviteCode(
          { user: { userId: 'tenant-user-1' } },
          { inviteCode: 'GOODCODE' },
        );

        expect(res.success).toBe(true);
        expect(consumeSpy).toHaveBeenCalledWith('GOODCODE', 'tenant-user-1', expect.anything());
        expect(userUpdate).toHaveBeenCalledWith({
          where: { id: 'tenant-user-1' },
          data: { invitedBy: 'admin-inviter' },
        });
      });
    });
  });

  describe('getMe (GET /auth/me)', () => {
    it('租客身份获取个人资料时，返回当前生效的 capabilities 列表', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: 'tenant-user-1',
        email: 'tenant@example.com',
        role: 'TENANT',
        isActive: true,
      } as any);

      const result = await controller.getMe({ user: { userId: 'tenant-user-1' } });
      expect(result.id).toBe('tenant-user-1');
      expect(result.capabilities).toEqual(['tenant.contract.read', 'tenant.bill.read']);
      expect(tenantCapabilityService.getEffectiveCapabilities).toHaveBeenCalledWith('tenant-user-1');
    });

    it('非租客身份（如 ADMIN）获取个人资料时，返回空 capabilities 数组和关闭的模拟器开关', async () => {
      const previous = process.env.FEATURE_METER_SIMULATOR;
      delete process.env.FEATURE_METER_SIMULATOR;
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: 'admin-user-1',
        email: 'admin@example.com',
        role: 'ADMIN',
        isActive: true,
      } as any);

      const result = await controller.getMe({ user: { userId: 'admin-user-1' } });
      expect(result.id).toBe('admin-user-1');
      expect(result.capabilities).toEqual([]);
      expect(result.features).toEqual({ meterSimulator: false });
      expect(tenantCapabilityService.getEffectiveCapabilities).not.toHaveBeenCalled();

      if (previous === undefined) delete process.env.FEATURE_METER_SIMULATOR;
      else process.env.FEATURE_METER_SIMULATOR = previous;
    });

    it('用户不存在时抛出 UnauthorizedException', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      await expect(
        controller.getMe({ user: { userId: 'non-existent' } }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

