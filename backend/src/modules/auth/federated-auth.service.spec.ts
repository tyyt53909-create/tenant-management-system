import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FederatedAuthService } from './federated-auth.service.js';

interface TxMock {
  user: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  userIdentity: { create: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  tenant: { update: ReturnType<typeof vi.fn> };
}

function createPrismaMock() {
  const tx: TxMock = {
    user: {
      create: vi.fn().mockResolvedValue({
        id: 'user-new',
        email: 'new@example.com',
        phone: null,
        role: 'TENANT',
        avatarUrl: null,
      }),
      update: vi.fn().mockResolvedValue({
        id: 'user-existing',
        email: 'existing@example.com',
        phone: null,
        role: 'TENANT',
        avatarUrl: null,
      }),
    },
    userIdentity: {
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    tenant: { update: vi.fn().mockResolvedValue({}) },
  };

  const prisma = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    tenant: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    userIdentity: {
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (callback: (client: TxMock) => unknown) =>
      callback(tx),
    ),
    __tx: tx,
  };
  return prisma;
}

function createService() {
  const prisma = createPrismaMock();
  const google = {
    getClientId: vi.fn().mockReturnValue('client-id'),
    isMockEnabled: vi.fn().mockReturnValue(false),
    verifyIdToken: vi.fn(),
  };
  const otp = { verifyCode: vi.fn(), sendCode: vi.fn() };
  const jwt = {
    generateTokens: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  };
  const invite = {
    validateInviteCode: vi.fn(),
    consumeInviteCode: vi.fn().mockResolvedValue(undefined),
  };

  const service = new FederatedAuthService(
    prisma as never,
    google as never,
    otp as never,
    jwt as never,
    invite as never,
  );
  return { service, prisma, google, otp, jwt, invite };
}

const googleUser = {
  googleId: 'google-sub-1',
  email: 'new@example.com',
  name: 'New',
  avatarUrl: 'https://avatar',
  emailVerified: true,
};

describe('FederatedAuthService Google 身份绑定（DEC-03）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('未验证邮箱直接拒绝', async () => {
    ctx.google.verifyIdToken.mockResolvedValue({ ...googleUser, emailVerified: false });

    await expect(ctx.service.googleAuth({ idToken: 't' })).rejects.toMatchObject({ status: 401 });
    expect(ctx.prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('旧 googleId 用户可直接登录并补建身份', async () => {
    ctx.google.verifyIdToken.mockResolvedValue(googleUser);
    ctx.prisma.user.findFirst.mockResolvedValue({
      id: 'user-existing',
      email: 'new@example.com',
      role: 'TENANT',
      isActive: true,
      googleId: 'google-sub-1',
      avatarUrl: null,
      emailVerifiedAt: null,
      tenant: null,
    });

    const result = await ctx.service.googleAuth({ idToken: 't' });

    expect(result.isNewUser).toBe(false);
    expect(ctx.prisma.__tx.userIdentity.upsert).toHaveBeenCalled();
    expect(ctx.prisma.__tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-existing' } }),
    );
  });

  it('新用户无邀请码返回 403，且不开启事务', async () => {
    ctx.google.verifyIdToken.mockResolvedValue(googleUser);
    ctx.prisma.user.findFirst.mockResolvedValue(null);

    await expect(ctx.service.googleAuth({ idToken: 't' })).rejects.toMatchObject({ status: 403 });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('新用户有邀请码但无预建租客返回 403', async () => {
    ctx.google.verifyIdToken.mockResolvedValue(googleUser);
    ctx.prisma.user.findFirst.mockResolvedValue(null);
    ctx.invite.validateInviteCode.mockResolvedValue({ valid: true, role: 'TENANT' });
    ctx.prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(
      ctx.service.googleAuth({ idToken: 't', inviteCode: 'INVITE-1' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('新用户有邀请码与预建租客时建号、写身份、绑定租客并核销', async () => {
    ctx.google.verifyIdToken.mockResolvedValue(googleUser);
    ctx.prisma.user.findFirst.mockResolvedValue(null);
    ctx.invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'TENANT',
    });
    ctx.prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-pre' });

    const result = await ctx.service.googleAuth({ idToken: 't', inviteCode: 'INVITE-1' });

    expect(result.isNewUser).toBe(true);
    expect(ctx.prisma.__tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'new@example.com', role: 'TENANT' }),
    });
    expect(ctx.prisma.__tx.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'GOOGLE', providerUserId: 'google-sub-1' }),
    });
    expect(ctx.prisma.__tx.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-pre' },
      data: { userId: 'user-new' },
    });
    expect(ctx.invite.consumeInviteCode).toHaveBeenCalledWith(
      'INVITE-1',
      'user-new',
      expect.anything(),
    );
  });
});

describe('FederatedAuthService 邮箱 OTP 绑定（DEC-03）', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('验证码错误直接拒绝', async () => {
    ctx.otp.verifyCode.mockResolvedValue(false);

    await expect(
      ctx.service.loginWithEmailCode({ email: 'new@example.com', code: '000000' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('新用户无邀请码返回 403，不创建账号', async () => {
    ctx.otp.verifyCode.mockResolvedValue(true);
    ctx.prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      ctx.service.loginWithEmailCode({ email: 'new@example.com', code: '123456' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('新用户有邀请码与预建租客时绑定成功', async () => {
    ctx.otp.verifyCode.mockResolvedValue(true);
    ctx.prisma.user.findFirst.mockResolvedValue(null);
    ctx.invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'TENANT',
    });
    ctx.prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-pre' });

    const result = await ctx.service.loginWithEmailCode({
      email: 'new@example.com',
      code: '123456',
      inviteCode: 'INVITE-1',
    });

    expect(result.isNewUser).toBe(true);
    expect(ctx.prisma.__tx.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'EMAIL', providerUserId: 'new@example.com' }),
    });
    expect(ctx.prisma.__tx.tenant.update).toHaveBeenCalled();
  });

  it('已有用户登录只补建身份，不创建账号', async () => {
    ctx.otp.verifyCode.mockResolvedValue(true);
    ctx.prisma.user.findFirst.mockResolvedValue({
      id: 'user-existing',
      email: 'existing@example.com',
      phone: null,
      role: 'TENANT',
      isActive: true,
      avatarUrl: null,
      emailVerifiedAt: null,
      tenant: { id: 'tenant-1' },
    });

    const result = await ctx.service.loginWithEmailCode({
      email: 'existing@example.com',
      code: '123456',
    });

    expect(result.isNewUser).toBe(false);
    expect(ctx.prisma.__tx.userIdentity.upsert).toHaveBeenCalled();
    expect(ctx.prisma.__tx.user.create).not.toHaveBeenCalled();
  });
});

describe('FederatedAuthService bindInviteCode', () => {
  it('非 TENANT 账号绑定了不同角色的邀请码时返回 409', async () => {
    const ctx = createService();
    ctx.invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'TENANT',
    });
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'user-admin',
      email: 'admin@example.com',
      phone: null,
      role: 'ADMIN',
      tenant: null,
    });

    await expect(
      ctx.service.bindInviteCode('user-admin', { inviteCode: 'INVITE-1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('无租客档案时按邮箱绑定预建租客并应用邀请码角色', async () => {
    const ctx = createService();
    ctx.invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'CLEANER',
    });
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'user-tenant',
      email: 'tenant@example.com',
      phone: null,
      role: 'TENANT',
      tenant: null,
    });
    ctx.prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-pre' });

    const result = await ctx.service.bindInviteCode('user-tenant', { inviteCode: 'INVITE-1' });

    expect(result.success).toBe(true);
    expect(ctx.prisma.__tx.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-pre' },
      data: { userId: 'user-tenant' },
    });
    expect(ctx.prisma.__tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-tenant' },
      data: { invitedBy: 'admin-1', role: 'CLEANER' },
    });
  });
});
