import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FederatedAuthService } from './federated-auth.service.js';

interface TxMock {
  user: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  userIdentity: { create: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  tenant: { updateMany: ReturnType<typeof vi.fn> };
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
    tenant: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };

  const prisma = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    tenant: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
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
  const smsOtp = {
    verifyCode: vi.fn().mockResolvedValue(true),
    sendCode: vi.fn().mockResolvedValue({ cooldown: 60 }),
  };
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
    smsOtp as never,
  );
  return { service, prisma, google, otp, smsOtp, jwt, invite };
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
    ctx.invite.validateInviteCode.mockResolvedValue({ valid: true, role: 'TENANT', tenantId: 'tenant-pre' });
    ctx.prisma.tenant.findUnique.mockResolvedValue(null);

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
      tenantId: 'tenant-pre',
    });
    ctx.prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-pre',
      email: 'new@example.com',
      phone: null,
      userId: null,
    });

    const result = await ctx.service.googleAuth({ idToken: 't', inviteCode: 'INVITE-1' });

    expect(result.isNewUser).toBe(true);
    expect(ctx.prisma.__tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'new@example.com', role: 'TENANT' }),
    });
    expect(ctx.prisma.__tx.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'GOOGLE', providerUserId: 'google-sub-1' }),
    });
    expect(ctx.prisma.__tx.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-pre', userId: null },
      data: { userId: 'user-new' },
    });
    expect(ctx.invite.consumeInviteCode).toHaveBeenCalledWith(
      'INVITE-1',
      'user-new',
      expect.anything(),
    );
  });

  it('预建档案在事务内已被占用时返回 409，且不核销邀请码', async () => {
    ctx.google.verifyIdToken.mockResolvedValue(googleUser);
    ctx.prisma.user.findFirst.mockResolvedValue(null);
    ctx.invite.validateInviteCode.mockResolvedValue({ valid: true, role: 'TENANT', tenantId: 'tenant-pre' });
    ctx.prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-pre',
      email: 'new@example.com',
      phone: null,
      userId: null,
    });
    ctx.prisma.__tx.tenant.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      ctx.service.googleAuth({ idToken: 't', inviteCode: 'INVITE-1' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(ctx.invite.consumeInviteCode).not.toHaveBeenCalled();
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
      tenantId: 'tenant-pre',
    });
    ctx.prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-pre',
      email: 'new@example.com',
      phone: null,
      userId: null,
    });

    const result = await ctx.service.loginWithEmailCode({
      email: 'new@example.com',
      code: '123456',
      inviteCode: 'INVITE-1',
    });

    expect(result.isNewUser).toBe(true);
    expect(ctx.prisma.__tx.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: 'EMAIL', providerUserId: 'new@example.com' }),
    });
    expect(ctx.prisma.__tx.tenant.updateMany).toHaveBeenCalled();
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

  it('租客不能用职员邀请码提升角色或认领档案', async () => {
    const ctx = createService();
    ctx.invite.validateInviteCode.mockResolvedValue({
      valid: true,
      invitedBy: 'admin-1',
      role: 'CLEANER',
      tenantId: null,
    });
    ctx.prisma.user.findUnique.mockResolvedValue({
      id: 'user-tenant',
      email: 'tenant@example.com',
      phone: null,
      role: 'TENANT',
      emailVerifiedAt: new Date(),
      tenant: null,
    });

    await expect(
      ctx.service.bindInviteCode('user-tenant', { inviteCode: 'INVITE-1' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(ctx.prisma.__tx.tenant.updateMany).not.toHaveBeenCalled();
    expect(ctx.prisma.__tx.user.update).not.toHaveBeenCalled();
  });
});

describe('FederatedAuthService SMS OTP (WX-03 / T292)', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('sendSmsCode 委托 smsOtpService 发送并返回 cooldown', async () => {
    const res = await ctx.service.sendSmsCode({ phone: '13800000001' });
    expect(res.cooldown).toBe(60);
    expect(ctx.smsOtp.sendCode).toHaveBeenCalledWith('13800000001');
  });

  it('loginWithSmsCode 验证码错误抛出 BadRequestException', async () => {
    ctx.smsOtp.verifyCode.mockResolvedValue(false);
    await expect(
      ctx.service.loginWithSmsCode({ phone: '13800000001', code: '000000' }),
    ).rejects.toThrow('验证码错误或已过期');
  });

  it('loginWithSmsCode 用户不存在且无邀请码抛出 403 (未预建)', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      ctx.service.loginWithSmsCode({ phone: '13800000001', code: '123456' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('loginWithSmsCode 用户存在直接登录并更新 lastLoginAt', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue({
      id: 'user-existing',
      phone: '13800000001',
      role: 'TENANT',
      isActive: true,
      tenant: null,
    });

    const res = await ctx.service.loginWithSmsCode({
      phone: '13800000001',
      code: '123456',
    });

    expect(res.isNewUser).toBe(false);
    expect(res.user.id).toBe('user-existing');
    expect(ctx.prisma.__tx.userIdentity.upsert).toHaveBeenCalled();
  });

  it('loginWithSmsCode 新用户带邀请码成功认领档案', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue(null);
    ctx.invite.validateInviteCode.mockResolvedValue({
      valid: true,
      tenantId: 't-pre',
      role: 'TENANT',
    });
    ctx.prisma.tenant.findUnique.mockResolvedValue({
      id: 't-pre',
      phone: '13800000001',
      userId: null,
    });

    const res = await ctx.service.loginWithSmsCode({
      phone: '13800000001',
      code: '123456',
      inviteCode: 'INV-SMS-1',
    });

    expect(res.isNewUser).toBe(true);
    expect(ctx.prisma.__tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: '13800000001' }),
      }),
    );
    expect(ctx.invite.consumeInviteCode).toHaveBeenCalled();
  });

  it('bindPhoneSms 绑定新手机号', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue(null); // 无冲突

    const res = await ctx.service.bindPhoneSms('user-1', {
      phone: '13912345678',
      code: '123456',
    });

    expect(res.success).toBe(true);
    expect(ctx.prisma.__tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { phone: '13912345678' },
    });
  });

  it('bindPhoneSms 手机号已被他人绑定时抛出 409 Conflict', async () => {
    ctx.prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });

    await expect(
      ctx.service.bindPhoneSms('user-1', {
        phone: '13912345678',
        code: '123456',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
