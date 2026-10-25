import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { ErrorCode } from '../../src/common/errors/error-codes.js';

let app: INestApplication;

process.env.WECHAT_AUTH_MOCK = 'true';

beforeAll(async () => {
  app = await createApp();
}, 30_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

async function createTenantProfile(adminToken: string, name: string, phone: string, email?: string) {
  const response = await http(app)
    .post('/tenants')
    .set(auth(adminToken))
    .send({ name, phone, email });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

describe('微信登录与身份绑定整合测试（T290 / WX-01 / DEC-03）', () => {
  it('GET /auth/wechat/config 返回配置与 mock 状态', async () => {
    const res = await http(app).get('/auth/wechat/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mockEnabled', true);
  });

  it('首次登录未绑定租客：返回 400 AUTH_WECHAT_UNBOUND 及 bindTicket，绝不创建孤儿 User/Tenant', async () => {
    const code = 'mock-wechat-code:wx_unbound_openid_01';
    const res = await http(app).post('/auth/wechat/login').send({ code });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.AUTH_WECHAT_UNBOUND);
    expect(res.body.details?.bindTicket).toMatch(/^wt_[a-f0-9]{48}$/);

    // 严禁产生 User / Tenant 孤儿记录（DEC-03）
    const identities = await prisma.userIdentity.findMany({
      where: { provider: 'WECHAT_MP', providerUserId: 'wx_unbound_openid_01' },
    });
    expect(identities).toHaveLength(0);

    const userCount = await prisma.user.count();
    // 仅初始 reset 后的状态，未新增 user
    const users = await prisma.user.findMany({ where: { role: 'TENANT' } });
    expect(users).toHaveLength(0);
  });

  it('防重放与非法票据：使用伪造 bindTicket 时返回 409 AUTH_CLAIM_REVERIFY', async () => {
    const res = await http(app).post('/auth/wechat/bind').send({
      bindTicket: 'wt_invalid_ticket_not_exists',
      phoneCode: 'mock-wechat-phone:13900001111',
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ErrorCode.AUTH_CLAIM_REVERIFY);
  });

  it('路径 A（手机号匹配）：精确匹配预建租客，原子建立 User 并认领档案；再次登录直接发放 Token', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const phone = '13912345678';
    const tenantId = await createTenantProfile(adminToken, '微信预建租客A', phone, 'tenant_a@example.com');

    // 1. 发起微信登录，获取 bindTicket
    const openid = 'wx_user_phone_path_01';
    const loginRes = await http(app)
      .post('/auth/wechat/login')
      .send({ code: `mock-wechat-code:${openid}` });
    expect(loginRes.status).toBe(400);
    const bindTicket = loginRes.body.details.bindTicket;

    // 2. 使用手机号授权凭据完成绑定
    const bindRes = await http(app).post('/auth/wechat/bind').send({
      bindTicket,
      phoneCode: `mock-wechat-phone:${phone}`,
    });

    expect(bindRes.status).toBe(201);
    expect(bindRes.body.isBound).toBe(true);
    expect(bindRes.body.accessToken).toBeTruthy();
    expect(bindRes.body.refreshToken).toBeTruthy();
    expect(bindRes.body.user).toMatchObject({
      phone,
      email: 'tenant_a@example.com',
      role: 'TENANT',
    });

    const newUserId = bindRes.body.user.id;

    // 3. 校验数据库：Tenant 档案已认领，UserIdentity 已建立
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(tenant?.userId).toBe(newUserId);

    const identity = await prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'WECHAT_MP',
          providerUserId: openid,
        },
      },
    });
    expect(identity).not.toBeNull();
    expect(identity?.userId).toBe(newUserId);

    // 4. bindTicket 消费后立即失效，防重放
    const replayRes = await http(app).post('/auth/wechat/bind').send({
      bindTicket,
      phoneCode: `mock-wechat-phone:${phone}`,
    });
    expect(replayRes.status).toBe(409);

    // 5. 已绑定微信账号再次登录：直接成功发放 Token
    const secondLoginRes = await http(app)
      .post('/auth/wechat/login')
      .send({ code: `mock-wechat-code:${openid}` });
    expect(secondLoginRes.status).toBe(201);
    expect(secondLoginRes.body.isBound).toBe(true);
    expect(secondLoginRes.body.user.id).toBe(newUserId);
  });

  it('路径 B（邀请码绑定）：核销预建租客邀请码并关联微信身份', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const tenantId = await createTenantProfile(adminToken, '微信预建租客B', '13888887777');

    const inviteRes = await http(app)
      .post('/auth/invite-codes')
      .set(auth(adminToken))
      .send({ role: 'TENANT', tenantId, expiryDays: 1 });
    expect(inviteRes.status).toBe(201);
    const inviteCode = (inviteRes.body.inviteCode ?? inviteRes.body.code) as string;

    const openid = 'wx_user_invite_path_02';
    const loginRes = await http(app)
      .post('/auth/wechat/login')
      .send({ code: `mock-wechat-code:${openid}` });
    const bindTicket = loginRes.body.details.bindTicket;

    const bindRes = await http(app).post('/auth/wechat/bind').send({
      bindTicket,
      inviteCode,
    });
    expect(bindRes.status).toBe(201);
    expect(bindRes.body.isBound).toBe(true);

    const boundUserId = bindRes.body.user.id;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(tenant?.userId).toBe(boundUserId);

    // 邀请码应已核销，不能重复使用
    const inviteRecord = await prisma.inviteCode.findUnique({ where: { code: inviteCode } });
    expect(inviteRecord?.status).toBe('USED');
    expect(inviteRecord?.usedById).toBe(boundUserId);
  });

  it('手机号未找到预建租客档案时返回 403 AUTH_ACCOUNT_NOT_PROVISIONED', async () => {
    const loginRes = await http(app)
      .post('/auth/wechat/login')
      .send({ code: 'mock-wechat-code:wx_unprovisioned_phone' });
    const bindTicket = loginRes.body.details.bindTicket;

    const bindRes = await http(app).post('/auth/wechat/bind').send({
      bindTicket,
      phoneCode: 'mock-wechat-phone:13700000000',
    });

    expect(bindRes.status).toBe(403);
    expect(bindRes.body.code).toBe(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED);
  });

  it('手机号已存在对应 User 时：微信绑定成功关联既有账号', async () => {
    const phone = '13611112222';
    const existingUser = await prisma.user.create({
      data: {
        phone,
        email: 'existing_user@example.com',
        role: 'TENANT',
        isActive: true,
      },
    });

    const loginRes = await http(app)
      .post('/auth/wechat/login')
      .send({ code: 'mock-wechat-code:wx_existing_user' });
    const bindTicket = loginRes.body.details.bindTicket;

    const bindRes = await http(app).post('/auth/wechat/bind').send({
      bindTicket,
      phoneCode: `mock-wechat-phone:${phone}`,
    });

    expect(bindRes.status).toBe(201);
    expect(bindRes.body.user.id).toBe(existingUser.id);

    const identity = await prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'WECHAT_MP',
          providerUserId: 'wx_existing_user',
        },
      },
    });
    expect(identity?.userId).toBe(existingUser.id);
  });

  it('已停用 User 尝试微信手机号绑定：返回 403 账号已被禁用', async () => {
    const phone = '13633334444';
    await prisma.user.create({
      data: {
        phone,
        email: 'disabled_user@example.com',
        role: 'TENANT',
        isActive: false,
      },
    });

    const loginRes = await http(app)
      .post('/auth/wechat/login')
      .send({ code: 'mock-wechat-code:wx_disabled_user' });
    const bindTicket = loginRes.body.details.bindTicket;

    const bindRes = await http(app).post('/auth/wechat/bind').send({
      bindTicket,
      phoneCode: `mock-wechat-phone:${phone}`,
    });

    expect(bindRes.status).toBe(403);
  });
});
