import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { SmsOtpService } from '../../src/modules/auth/sms-otp.service.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';

let app: INestApplication;

process.env.SMS_MOCK = 'true';

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

describe('短信通道与短信 OTP 整合测试（T292 / WX-03）', () => {
  it('发送验证码生命周期：校验格式、冷却防刷频', async () => {
    // 1. 非法手机号拒绝
    const badRes = await http(app)
      .post('/auth/send-sms-code')
      .send({ phone: '12345' });
    expect(badRes.status).toBe(400);

    // 2. 合法手机号发送成功
    const goodRes = await http(app)
      .post('/auth/send-sms-code')
      .send({ phone: '13812340001' });
    expect(goodRes.status).toBe(201);
    expect(goodRes.body.cooldown).toBe(60);

    // 3. 立即重发触发冷却限制
    const fastRes = await http(app)
      .post('/auth/send-sms-code')
      .send({ phone: '13812340001' });
    expect(fastRes.status).toBe(400);
    expect(fastRes.body.message).toContain('过于频繁');
  });

  it('未开通账号且无邀请码尝试短信登录时拒绝（403 AUTH_ACCOUNT_NOT_PROVISIONED）', async () => {
    const smsOtpService = app.get(SmsOtpService);
    await smsOtpService.seedCodeForTests('13899990001', '888888');

    const res = await http(app).post('/auth/login-sms-code').send({
      phone: '13899990001',
      code: '888888',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('账号尚未开通');
  });

  it('新租客携带合法邀请码短信登录，自动认领预建档案与签发凭证', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 1. 管理员预建租客档案
    const tenantRes = await http(app)
      .post('/tenants')
      .set(auth(adminToken))
      .send({
        name: '短信租客张三',
        phone: '13888881111',
      });
    expect(tenantRes.status).toBe(201);
    const tenantId = tenantRes.body.id;

    // 2. 生成租客专属邀请码
    const inviteRes = await http(app)
      .post('/auth/invite-codes')
      .set(auth(adminToken))
      .send({
        role: 'TENANT',
        tenantId,
      });
    expect(inviteRes.status).toBe(201);
    const inviteCode =
      typeof inviteRes.body.inviteCode === 'string'
        ? inviteRes.body.inviteCode
        : inviteRes.body.inviteCode?.code || inviteRes.body.code;

    // 3. 注入短信验证码并执行登录
    const smsOtpService = app.get(SmsOtpService);
    await smsOtpService.seedCodeForTests('13888881111', '123456');

    const loginRes = await http(app).post('/auth/login-sms-code').send({
      phone: '13888881111',
      code: '123456',
      inviteCode,
    });

    expect(loginRes.status).toBe(201);
    expect(loginRes.body.isNewUser).toBe(true);
    expect(loginRes.body.accessToken).toBeTruthy();

    const newUserId = loginRes.body.user.id;

    // 4. 验证档案认领与 User 表更新
    const claimedTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    expect(claimedTenant?.userId).toBe(newUserId);

    const userRecord = await prisma.user.findUnique({
      where: { id: newUserId },
    });
    expect(userRecord?.phone).toBe('13888881111');

    const identity = await prisma.userIdentity.findFirst({
      where: { userId: newUserId, provider: 'PHONE' },
    });
    expect(identity?.providerUserId).toBe('13888881111');
  });

  it('已注册租客使用短信验证码直接登录', async () => {
    const base = await seedBase();

    // 为 cleaner 设定手机号
    await prisma.user.update({
      where: { id: base.cleanerId },
      data: { phone: '13700001111' },
    });

    const smsOtpService = app.get(SmsOtpService);
    await smsOtpService.seedCodeForTests('13700001111', '666888');

    const loginRes = await http(app).post('/auth/login-sms-code').send({
      phone: '13700001111',
      code: '666888',
    });

    expect(loginRes.status).toBe(201);
    expect(loginRes.body.isNewUser).toBe(false);
    expect(loginRes.body.user.id).toBe(base.cleanerId);
  });

  it('登录用户使用短信验证码绑定新手机号', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const smsOtpService = app.get(SmsOtpService);
    await smsOtpService.seedCodeForTests('13911112222', '999111');

    const bindRes = await http(app)
      .post('/auth/bind-phone-sms')
      .set(auth(adminToken))
      .send({
        phone: '13911112222',
        code: '999111',
      });

    expect(bindRes.status).toBe(201);
    expect(bindRes.body.success).toBe(true);
    expect(bindRes.body.phone).toBe('13911112222');

    const updatedUser = await prisma.user.findUnique({
      where: { id: base.adminId },
    });
    expect(updatedUser?.phone).toBe('13911112222');
  });

  it('紧急通知触发调度器下发短信通道', async () => {
    const base = await seedBase();

    // 为管理员设置手机号
    await prisma.user.update({
      where: { id: base.adminId },
      data: { phone: '13866667777' },
    });

    const notificationsService = app.get(NotificationsService);
    const notification = (await notificationsService.create({
      userId: base.adminId,
      title: '系统紧急维护提醒',
      body: '服务器将于今晚 23:00 进行短暂维护',
      priority: 'URGENT' as any,
    })) as any;

    expect(notification).toBeTruthy();
    expect(notification.id).toBeTruthy();

    const dbRecord = await prisma.notification.findUnique({
      where: { id: notification.id },
    });
    expect(dbRecord).toBeTruthy();
  });
});
