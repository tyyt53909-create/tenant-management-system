import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';

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

describe('微信订阅消息与额度管理整合测试（T291 / WX-02）', () => {
  it('授权上报与额度查询生命周期（accept / reject / ban）', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 1. 查询初始额度：默认 0
    const initialRes = await http(app)
      .get('/notifications/wechat/subscribe-quota?templateId=tmpl-bill')
      .set(auth(adminToken));
    expect(initialRes.status).toBe(200);
    expect(initialRes.body).toEqual({ templateId: 'tmpl-bill', quota: 0 });

    // 2. 上报授权 accept -> 额度 +1
    const reportRes = await http(app)
      .post('/notifications/wechat/subscribe-report')
      .set(auth(adminToken))
      .send({ templateId: 'tmpl-bill', action: 'accept' });
    expect(reportRes.status).toBe(201);
    expect(reportRes.body).toMatchObject({ templateId: 'tmpl-bill', quota: 1, status: 'ACCEPTED' });

    // 3. 再次查询额度为 1
    const secondRes = await http(app)
      .get('/notifications/wechat/subscribe-quota?templateId=tmpl-bill')
      .set(auth(adminToken));
    expect(secondRes.status).toBe(200);
    expect(secondRes.body).toEqual({ templateId: 'tmpl-bill', quota: 1 });

    // 4. 用户选择 ban -> 额度被清空
    const banRes = await http(app)
      .post('/notifications/wechat/subscribe-report')
      .set(auth(adminToken))
      .send({ templateId: 'tmpl-bill', action: 'ban' });
    expect(banRes.status).toBe(201);
    expect(banRes.body).toMatchObject({ templateId: 'tmpl-bill', quota: 0, status: 'BANNED' });
  });

  it('通知调度：用户绑定微信身份且拥有额度时，成功下发并扣减额度', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 为管理员绑定 mock 微信身份
    await prisma.userIdentity.create({
      data: {
        userId: base.adminId,
        provider: 'WECHAT_MP',
        providerUserId: 'mock-openid-admin',
      },
    });

    // 授权增加 1 次额度
    await http(app)
      .post('/notifications/wechat/subscribe-report')
      .set(auth(adminToken))
      .send({ templateId: 'mock-tmpl-bill', action: 'accept' });

    const notificationsService = app.get(NotificationsService);

    // 触发通知下发（指定 wechat 和 in-app 渠道）
    const notification = (await notificationsService.create({
      userId: base.adminId,
      title: '月度账单已生成',
      body: '您的2026年10月账单已生成，请及时缴费',
      priority: 'URGENT' as any,
      data: { type: 'BILL', templateId: 'mock-tmpl-bill' },
    })) as any;

    expect(notification).toBeTruthy();
    expect(notification.id).toBeTruthy();

    // 校验额度已成功扣减为 0
    const quotaRes = await http(app)
      .get('/notifications/wechat/subscribe-quota?templateId=mock-tmpl-bill')
      .set(auth(adminToken));
    expect(quotaRes.body.quota).toBe(0);
  });

  it('未绑定微信身份时跳过微信推送，站内信正常落库', async () => {
    const base = await seedBase();
    const notificationsService = app.get(NotificationsService);

    // cleaner 没有绑定 WECHAT_MP
    const notification = (await notificationsService.create({
      userId: base.cleanerId,
      title: '工单提醒',
      body: '测试未绑定微信下发',
      priority: 'NORMAL' as any,
      data: { type: 'MAINTENANCE' },
    })) as any;

    expect(notification).toBeTruthy();
    expect(notification.id).toBeTruthy();

    // 站内通知落库成功
    const dbRecord = await prisma.notification.findUnique({
      where: { id: notification.id },
    });
    expect(dbRecord?.userId).toBe(base.cleanerId);
  });

  it('微信接口返回 43101（未授权/额度耗尽）时优雅清零本地额度且不阻断通知流', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 绑定会导致 mock-quota-exhausted 的 openid
    await prisma.userIdentity.create({
      data: {
        userId: base.adminId,
        provider: 'WECHAT_MP',
        providerUserId: 'mock-quota-exhausted',
      },
    });

    // 伪造本地有 2 次额度
    await http(app)
      .post('/notifications/wechat/subscribe-report')
      .set(auth(adminToken))
      .send({ templateId: 'mock-tmpl-maint', action: 'accept' });

    const notificationsService = app.get(NotificationsService);

    const notification = (await notificationsService.create({
      userId: base.adminId,
      title: '报修处理进展',
      body: '您的工单已受理',
      priority: 'URGENT' as any,
      data: { type: 'MAINTENANCE', templateId: 'mock-tmpl-maint' },
    })) as any;

    expect(notification).toBeTruthy();
    expect(notification.id).toBeTruthy();

    // 本地额度已被自动清空为 0
    const quotaRes = await http(app)
      .get('/notifications/wechat/subscribe-quota?templateId=mock-tmpl-maint')
      .set(auth(adminToken));
    expect(quotaRes.body.quota).toBe(0);
  });
});
