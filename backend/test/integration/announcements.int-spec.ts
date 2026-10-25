import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, login, http, auth } from './harness.js';

/**
 * COM-04 / T284：公告与定向消息（真实 DB）。
 *
 * 关注点：
 * 1. 定向解析（楼栋/标签/指定租客）只投递到目标租客；
 * 2. 重发幂等（去重键），不会给同一人发第二条；
 * 3. 已发布公告不可编辑/删除，只能归档；
 * 4. 只有 ADMIN 能访问公告管理接口。
 */
let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('公告与定向消息（COM-04）', () => {
  it('ALL_TENANTS 草稿 → 发布后每个有账号租客各收到一条', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const created = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({ title: '停水通知', body: '周六上午停水', audience: 'ALL_TENANTS' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('DRAFT');

    const published = await http(app)
      .post(`/announcements/${created.body.id}/publish`)
      .set(auth(tenancy.adminToken));
    expect(published.status).toBe(201);
    expect(published.body).toMatchObject({ recipients: 1, failed: 0 });

    const tenantUser = await prisma.tenant.findUniqueOrThrow({ where: { id: tenancy.tenantId } });
    const tenantNotifications = await http(app)
      .get('/notifications')
      .set(auth(tenancy.tenantToken));
    expect(tenantNotifications.status).toBe(200);
    expect(tenantNotifications.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: '停水通知', userId: tenantUser.userId }),
      ]),
    );
    expect(tenantNotifications.body.data.find((n: any) => n.title === '停水通知')?.isRead).toBe(false);

    // 管理员本人不在受众内
    const adminNotifications = await prisma.notification.count({
      where: { userId: base.adminId },
    });
    expect(adminNotifications).toBe(0);
  });

  it('重发幂等：同一公告不会重复投递', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const created = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({ title: '重复发布', body: '只应收到一次', publish: true });
    expect(created.status).toBe(201);

    const again = await http(app)
      .post(`/announcements/${created.body.announcement.id}/publish`)
      .set(auth(tenancy.adminToken));
    expect(again.status).toBe(201);

    const count = await prisma.notification.count({ where: { title: '重复发布' } });
    expect(count).toBe(1);
  });

  it('BUILDING 定向：只发给该楼栋 ACTIVE 合同的租客', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    // 第二个楼栋 + 租客（不在目标楼栋内）
    const otherBuilding = await prisma.building.create({
      data: { name: '另一栋', floors: 2 },
    });
    const outsider = await prisma.tenant.create({
      data: {
        name: '外部租客',
        phone: '13900000001',
        user: { create: { email: 'outsider@example.com', passwordHash: 'x', role: 'TENANT' } },
      },
    });
    expect(outsider.id).toBeTruthy();

    const created = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({
        title: '本栋电梯检修',
        body: '周一停梯两小时',
        audience: 'BUILDING',
        targetIds: [base.buildingId],
        publish: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.recipients).toBe(1);

    const targetTitle = await prisma.notification.count({ where: { title: '本栋电梯检修' } });
    expect(targetTitle).toBe(1);

    // 另一栋楼 ID 不在目标内，作为对照：定向不存在的楼栋应 400
    const invalid = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({
        title: '无效目标',
        body: 'x',
        audience: 'BUILDING',
        targetIds: [otherBuilding.id, 'missing-building'],
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain('missing-building');
  });

  it('TAGS 定向：只发给带该标签的租客', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const tag = await prisma.tag.create({ data: { name: '学生', sort: 0 } });
    const otherTag = await prisma.tag.create({ data: { name: '上班族', sort: 1 } });
    await prisma.tenantTag.create({ data: { tenantId: tenancy.tenantId, tagId: tag.id } });

    const created = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({
        title: '学生专属',
        body: '暑期优惠',
        audience: 'TAGS',
        targetIds: [tag.id],
        publish: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.recipients).toBe(1);

    const notTarget = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({
        title: '上班族专属',
        body: '无人在此标签',
        audience: 'TAGS',
        targetIds: [otherTag.id],
        publish: true,
      });
    expect(notTarget.status).toBe(201);
    expect(notTarget.body.recipients).toBe(0);
    expect(await prisma.notification.count({ where: { title: '上班族专属' } })).toBe(0);
  });

  it('已发布公告不能编辑或删除，归档后仍保留接收记录', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const created = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({ title: '已发布', body: '正文', publish: true });
    const id = created.body.announcement.id as string;

    const patch = await http(app)
      .patch(`/announcements/${id}`)
      .set(auth(tenancy.adminToken))
      .send({ title: '改名', body: '改正文' });
    expect(patch.status).toBe(409);

    const del = await http(app)
      .delete(`/announcements/${id}`)
      .set(auth(tenancy.adminToken));
    expect(del.status).toBe(409);

    const archived = await http(app)
      .post(`/announcements/${id}/archive`)
      .set(auth(tenancy.adminToken));
    expect(archived.status).toBe(201);
    expect(archived.body.status).toBe('ARCHIVED');

    // 已送达的通知不随归档回收
    expect(await prisma.notification.count({ where: { title: '已发布' } })).toBe(1);
  });

  it('草稿可编辑删除；CLEANER / TENANT 无法访问公告管理接口', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const created = await http(app)
      .post('/announcements')
      .set(auth(tenancy.adminToken))
      .send({ title: '草稿', body: '正文' });
    const id = created.body.id as string;

    const patched = await http(app)
      .patch(`/announcements/${id}`)
      .set(auth(tenancy.adminToken))
      .send({ title: '草稿-改', body: '正文-改' });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe('草稿-改');

    const cleanerToken = await login(app, base.cleanerEmail, base.cleanerPassword);
    for (const token of [cleanerToken, tenancy.tenantToken]) {
      const list = await http(app).get('/announcements').set(auth(token));
      expect(list.status).toBe(403);
      const createAttempt = await http(app)
        .post('/announcements')
        .set(auth(token))
        .send({ title: '越权', body: 'x' });
      expect(createAttempt.status).toBe(403);
    }

    const removed = await http(app)
      .delete(`/announcements/${id}`)
      .set(auth(tenancy.adminToken));
    expect(removed.status).toBe(200);
    expect(await prisma.announcement.count()).toBe(0);
  });
});
