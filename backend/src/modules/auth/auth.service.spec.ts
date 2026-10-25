import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { InviteCodeService } from './invite-code.service.js';
import { JwtAuthService } from './jwt.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoogleAuthService } from './google-auth.service.js';
import { EmailOtpService } from './email-otp.service.js';
import { TenantCapabilityService } from '../tenant-capabilities/tenant-capability.service.js';
import {
  LOGIN_ATTEMPT_STORE,
  MemoryLoginAttemptStore,
} from './login-attempt.store.js';
import { FederatedAuthService } from './federated-auth.service.js';

const WRONG_PASSWORD = 'wrong-password';
const CORRECT_PASSWORD = 'correct-password';

interface PrismaMock {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  userIdentity: {
    create: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  tenant: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function createPrismaMock(): PrismaMock {
  const prisma: PrismaMock = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    },
    userIdentity: { create: vi.fn().mockResolvedValue({}), upsert: vi.fn().mockResolvedValue({}) },
    tenant: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => unknown) =>
    callback(prisma),
  );
  return prisma;
}

interface InviteCodeMock {
  validateInviteCode: ReturnType<typeof vi.fn>;
  consumeInviteCode: ReturnType<typeof vi.fn>;
}

async function createService(
  env: Record<string, string> = {},
  store: MemoryLoginAttemptStore = new MemoryLoginAttemptStore(),
): Promise<{
  service: AuthService;
  prisma: PrismaMock;
  store: MemoryLoginAttemptStore;
  invite: InviteCodeMock;
  jwt: { generateTokens: ReturnType<typeof vi.fn>; revokeUserSessions: ReturnType<typeof vi.fn> };
  otp: { sendCode: ReturnType<typeof vi.fn>; verifyCode: ReturnType<typeof vi.fn> };
}> {
  const prisma = createPrismaMock();
  const jwt = { generateTokens: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }), revokeUserSessions: vi.fn() };
  const otp = { sendCode: vi.fn(), verifyCode: vi.fn() };
  const invite: InviteCodeMock = {
    validateInviteCode: vi.fn().mockResolvedValue({ valid: false }),
    consumeInviteCode: vi.fn().mockResolvedValue(undefined),
  };
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: InviteCodeService, useValue: invite },
      {
        provide: JwtAuthService,
         useValue: jwt,
      },
      { provide: PrismaService, useValue: prisma },
      { provide: GoogleAuthService, useValue: {} },
      { provide: EmailOtpService, useValue: otp },
      { provide: TenantCapabilityService, useValue: {} },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          BCRYPT_ROUNDS: '10',
          LOGIN_MAX_FAILED_ATTEMPTS: '5',
          LOGIN_LOCK_MS: '900000',
          ...env,
        }),
      },
      { provide: LOGIN_ATTEMPT_STORE, useValue: store },
      // QLT-02 / T288：FederatedAuthService 由容器提供（改动前是 AuthService 内部 new）
      {
        provide: FederatedAuthService,
        useValue: { googleAuth: vi.fn(), sendEmailCode: vi.fn(), loginWithEmailCode: vi.fn(), bindInviteCode: vi.fn() },
      },
    ],
  }).compile();

  return { service: moduleRef.get(AuthService), prisma, store, invite, jwt, otp };
}

function userWith(over: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'tenant@example.com',
    phone: null,
    role: 'TENANT',
    isActive: true,
    passwordHash: null,
    ...over,
  };
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    if (error instanceof HttpException) return error.getStatus() === status;
    return false;
  });
}

describe('AuthService 登录防护', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  let store: MemoryLoginAttemptStore;

  beforeEach(async () => {
    ({ service, prisma, store } = await createService());
  });

  it('未知账号前 4 次返回 401，第 5 次起返回 429 且不再查库', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expectStatus(
        service.login({ identifier: 'ghost@example.com', password: WRONG_PASSWORD }),
        HttpStatus.UNAUTHORIZED,
      );
    }

    await expectStatus(
      service.login({ identifier: 'ghost@example.com', password: WRONG_PASSWORD }),
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(5);

    await expectStatus(
      service.login({ identifier: 'ghost@example.com', password: WRONG_PASSWORD }),
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(5);
  });

  it('密码错误达到阈值后锁定，窗口过后恢复', async () => {
    const shortLock = await createService({ LOGIN_LOCK_MS: '1000' });
    const passwordHash = await bcrypt.hash(CORRECT_PASSWORD, 10);
    shortLock.prisma.user.findFirst.mockResolvedValue(userWith({ passwordHash }));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expectStatus(
        shortLock.service.login({ identifier: 'tenant@example.com', password: WRONG_PASSWORD }),
        HttpStatus.UNAUTHORIZED,
      );
    }
    await expectStatus(
      shortLock.service.login({ identifier: 'tenant@example.com', password: WRONG_PASSWORD }),
      HttpStatus.TOO_MANY_REQUESTS,
    );

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const result = await shortLock.service.login({
      identifier: 'tenant@example.com',
      password: CORRECT_PASSWORD,
    });
    expect(result.accessToken).toBe('a');
    expect(await shortLock.store.getFailures('tenant@example.com')).toBe(0);
  });

  it('成功登录清零失败计数', async () => {
    const passwordHash = await bcrypt.hash(CORRECT_PASSWORD, 10);
    prisma.user.findFirst.mockResolvedValue(userWith({ passwordHash }));

    await expectStatus(
      service.login({ identifier: 'tenant@example.com', password: WRONG_PASSWORD }),
      HttpStatus.UNAUTHORIZED,
    );
    expect(await store.getFailures('tenant@example.com')).toBe(1);

    await service.login({ identifier: 'tenant@example.com', password: CORRECT_PASSWORD });
    expect(await store.getFailures('tenant@example.com')).toBe(0);
  });

  it('无密码账号与密码错误返回相同的 401 文案', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(userWith({ passwordHash: null }));
    const noPasswordError = await service
      .login({ identifier: 'tenant@example.com', password: WRONG_PASSWORD })
      .catch((error: unknown) => error);

    prisma.user.findFirst.mockResolvedValueOnce(
      userWith({ passwordHash: await bcrypt.hash(CORRECT_PASSWORD, 10) }),
    );
    const wrongPasswordError = await service
      .login({ identifier: 'tenant@example.com', password: WRONG_PASSWORD })
      .catch((error: unknown) => error);

    expect(noPasswordError).toBeInstanceOf(UnauthorizedException);
    expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
    expect((noPasswordError as UnauthorizedException).message).toBe(
      (wrongPasswordError as UnauthorizedException).message,
    );
  });

  it('禁用账号在密码错误时返回 401，密码正确才返回 403', async () => {
    const passwordHash = await bcrypt.hash(CORRECT_PASSWORD, 10);
    prisma.user.findFirst.mockResolvedValue(userWith({ passwordHash, isActive: false }));

    await expectStatus(
      service.login({ identifier: 'tenant@example.com', password: WRONG_PASSWORD }),
      HttpStatus.UNAUTHORIZED,
    );
    await expect(service.login({ identifier: 'tenant@example.com', password: CORRECT_PASSWORD })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('既有 cost 10 哈希仍可登录', async () => {
    const passwordHash = await bcrypt.hash(CORRECT_PASSWORD, 10);
    prisma.user.findFirst.mockResolvedValue(userWith({ passwordHash }));

    const result = await service.login({
      identifier: 'tenant@example.com',
      password: CORRECT_PASSWORD,
    });
    expect(result.user.id).toBe('user-1');
  });
});

describe('AuthService 注册策略（DEC-03）', () => {
  it('新注册使用 BCRYPT_ROUNDS 配置的 cost，并绑定预建租客', async () => {
    const { service, prisma, invite, otp } = await createService({ BCRYPT_ROUNDS: '12' });
    otp.verifyCode.mockResolvedValue(true);
    invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'TENANT',
      tenantId: 'tenant-pre',
    });

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-pre',
      email: 'new@example.com',
      phone: '13800000000',
      userId: null,
    });
    prisma.user.create.mockResolvedValue({
      id: 'user-new',
      email: 'new@example.com',
      role: 'TENANT',
    });

    await service.register({
      email: 'new@example.com',
      password: CORRECT_PASSWORD,
      inviteCode: 'INVITE-1',
      emailCode: '654321',
    });

    const created = prisma.user.create.mock.calls[0]?.[0] as {
      data: { passwordHash: string; role: string };
    };
    expect(bcrypt.getRounds(created.data.passwordHash)).toBe(12);
    expect(created.data.role).toBe('TENANT');
    expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-pre', userId: null },
      data: { userId: 'user-new' },
    });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'EMAIL', providerUserId: 'new@example.com' }),
    });
  });

  it('职员邀请只建职员账号，不认领租客', async () => {
    const { service, prisma, invite, otp } = await createService({ BCRYPT_ROUNDS: '10' });
    otp.verifyCode.mockResolvedValue(true);
    invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'CLEANER',
      tenantId: null,
    });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-cleaner',
      email: 'cleaner@example.com',
      role: 'CLEANER',
    });

    const result = await service.register({
      email: 'cleaner@example.com',
      password: CORRECT_PASSWORD,
      inviteCode: 'INVITE-CLEANER',
      emailCode: '654321',
    });

    expect(prisma.user.create.mock.calls[0][0].data.role).toBe('CLEANER');
    expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    expect(result.user.role).toBe('CLEANER');
  });

  it('没有绑定预建档案的租客邀请拒绝注册，不创建任何人', async () => {
    const { service, prisma, invite, otp } = await createService();
    otp.verifyCode.mockResolvedValue(true);
    invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'TENANT',
      tenantId: null,
    });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.register({
        email: 'new@example.com',
        password: CORRECT_PASSWORD,
        inviteCode: 'INVITE-1',
        emailCode: '654321',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });
});

describe('AuthService 密码生命周期', () => {
  it('change requires correct old password and revokes sessions after successful change', async () => {
    const { service, prisma, jwt } = await createService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash: await bcrypt.hash('old-password', 10) });
    await expectStatus(service.changePassword('user-1', { oldPassword: 'wrong-password', newPassword: 'new-password' }), 401);
    expect(prisma.user.update).not.toHaveBeenCalled();
    await service.changePassword('user-1', { oldPassword: 'old-password', newPassword: 'new-password' });
    expect(prisma.user.update).toHaveBeenCalled();
    expect(jwt.revokeUserSessions).toHaveBeenCalledWith('user-1');
  });

  it('forgot responds identically for known and unknown emails', async () => {
    const { service, prisma, otp } = await createService();
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValueOnce(null);
    const known = await service.forgotPassword({ email: 'User@Example.com' });
    const unknown = await service.forgotPassword({ email: 'missing@example.com' });
    expect(known).toEqual(unknown);
    expect(otp.sendCode).toHaveBeenCalledWith('user@example.com');
    expect(otp.sendCode).toHaveBeenCalledTimes(1);
  });

  it('reset validates OTP, hashes password, and revokes sessions', async () => {
    const { service, prisma, otp, jwt } = await createService();
    otp.verifyCode.mockResolvedValue(false);
    await expectStatus(service.resetPassword({ email: 'user@example.com', code: '000000', newPassword: 'new-password' }), 400);
    expect(prisma.user.update).not.toHaveBeenCalled();
    otp.verifyCode.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await service.resetPassword({ email: 'User@Example.com', code: '123456', newPassword: 'new-password' });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' }, data: { passwordHash: expect.stringMatching(/^\$2[aby]\$/) } }));
    expect(jwt.revokeUserSessions).toHaveBeenCalledWith('u1');
  });
});
