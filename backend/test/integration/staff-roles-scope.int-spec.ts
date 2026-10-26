import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';
import { assertStaffBuildingAccess } from '../../src/common/utils/building-scope.util.js';

let app: INestApplication;

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

describe('员工多角色、权限与楼栋管辖范围集成测试（T302 / WRK-01 / DEC-08）', () => {
  it('员工多角色创建、负责楼栋指派与管辖范围隔离全闭环', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 1. 准备多栋楼宇
    const buildingA = await prisma.building.create({
      data: { name: 'A栋朝阳公寓', floors: 6, isActive: true },
    });
    const buildingB = await prisma.building.create({
      data: { name: 'B栋望海大厦', floors: 12, isActive: true },
    });

    // 2. 创建不同角色的员工账号（管家、财务、维修、保洁、业主）
    // 2.1 创建物业管家并同时指派 Building A & B
    const createPmRes = await http(app)
      .post('/staff')
      .set(auth(adminToken))
      .send({
        email: 'pm-manager@example.com',
        password: '{{SECRET_d1ff25s6}}',
        phone: '13700001111',
        role: 'PROPERTY_MANAGER',
        buildingIds: [buildingA.id, buildingB.id],
      });
    expect(createPmRes.status).toBe(201);
    expect(createPmRes.body.role).toBe('PROPERTY_MANAGER');
    expect(createPmRes.body.assignedBuildingIds).toContain(buildingA.id);
    expect(createPmRes.body.assignedBuildingIds).toContain(buildingB.id);
    expect(createPmRes.body).not.toHaveProperty('passwordHash');
    const pmId = createPmRes.body.id;

    // 2.2 创建保洁员工仅指派 Building A
    const createCleanerRes = await http(app)
      .post('/staff')
      .set(auth(adminToken))
      .send({
        email: 'cleaner-pro@example.com',
        password: '{{SECRET_d1ff25s6}}',
        phone: '13700002222',
        role: 'CLEANER',
        buildingIds: [buildingA.id],
      });
    expect(createCleanerRes.status).toBe(201);
    expect(createCleanerRes.body.role).toBe('CLEANER');
    const cleanerId = createCleanerRes.body.id;

    // 2.3 创建维修师傅
    const createMaintRes = await http(app)
      .post('/staff')
      .set(auth(adminToken))
      .send({
        email: 'maint-fix@example.com',
        password: '{{SECRET_d1ff25s6}}',
        role: 'MAINTAINER',
      });
    expect(createMaintRes.status).toBe(201);
    expect(createMaintRes.body.role).toBe('MAINTAINER');

    // 2.4 创建财务人员
    const createFinRes = await http(app)
      .post('/staff')
      .set(auth(adminToken))
      .send({
        email: 'finance-lead@example.com',
        password: '{{SECRET_d1ff25s6}}',
        role: 'FINANCIAL',
      });
    expect(createFinRes.status).toBe(201);
    expect(createFinRes.body.role).toBe('FINANCIAL');

    // 2.5 尝试通过员工接口创建 TENANT 角色被拒绝
    const invalidTenantRes = await http(app)
      .post('/staff')
      .set(auth(adminToken))
      .send({
        email: 'fake-tenant@example.com',
        password: '{{SECRET_d1ff25s6}}',
        role: 'TENANT',
      });
    expect(invalidTenantRes.status).toBe(400);

    // 3. 员工列表与条件查询
    const listRes = await http(app)
      .get('/staff?role=PROPERTY_MANAGER')
      .set(auth(adminToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBe(1);
    expect(listRes.body.items[0].email).toBe('pm-manager@example.com');

    // 按管辖楼栋筛选员工
    const filterByBuildingRes = await http(app)
      .get(`/staff?buildingId=${buildingB.id}`)
      .set(auth(adminToken));
    expect(filterByBuildingRes.status).toBe(200);
    expect(filterByBuildingRes.body.items.some((i: any) => i.id === pmId)).toBe(true);
    expect(filterByBuildingRes.body.items.some((i: any) => i.id === cleanerId)).toBe(false);

    // 4. 动态调整员工负责楼栋（assignBuildings）
    const reassignRes = await http(app)
      .post(`/staff/${cleanerId}/buildings`)
      .set(auth(adminToken))
      .send({ buildingIds: [buildingA.id, buildingB.id] });
    expect(reassignRes.status).toBe(201);
    expect(reassignRes.body.length).toBe(2);

    // 分配不存在的楼栋 ID 报错
    const invalidBuildingRes = await http(app)
      .post(`/staff/${cleanerId}/buildings`)
      .set(auth(adminToken))
      .send({ buildingIds: ['non-existent-building-cuid'] });
    expect(invalidBuildingRes.status).toBe(400);

    // 5. 员工登录并查询自己管辖的楼栋（/staff/me/buildings）
    const jwt = app.get(JwtAuthService);
    const pmTokens = await jwt.generateTokens({ sub: pmId, role: 'PROPERTY_MANAGER' });
    const pmToken = pmTokens.accessToken;

    const myBuildingsRes = await http(app)
      .get('/staff/me/buildings')
      .set(auth(pmToken));
    expect(myBuildingsRes.status).toBe(200);
    expect(myBuildingsRes.body.length).toBe(2);
    expect(myBuildingsRes.body.some((b: any) => b.id === buildingA.id)).toBe(true);
    expect(myBuildingsRes.body.some((b: any) => b.id === buildingB.id)).toBe(true);

    // 6. 验证楼栋数据范围辅助断言函数
    await expect(
      assertStaffBuildingAccess(prisma as any, { userId: pmId, role: 'PROPERTY_MANAGER' }, buildingA.id),
    ).resolves.toBeUndefined();

    // 构造一个未被指派管辖该楼栋的维修工
    const maintUser = createMaintRes.body;
    await expect(
      assertStaffBuildingAccess(prisma as any, { userId: maintUser.id, role: 'MAINTAINER' }, buildingB.id),
    ).rejects.toThrow(/无权访问/);

    // ADMIN 具备全量访问权限
    await expect(
      assertStaffBuildingAccess(prisma as any, { userId: base.adminId, role: 'ADMIN' }, buildingA.id),
    ).resolves.toBeUndefined();

    // 7. 安全防线验证：最后一位管理员不可被降级或停用，管理员不可停用自己
    const deactivateSelfRes = await http(app)
      .patch(`/staff/${base.adminId}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deactivateSelfRes.status).toBe(400);
    expect(deactivateSelfRes.body.message).toContain('不能停用自己的账号');

    const demoteLastAdminRes = await http(app)
      .patch(`/staff/${base.adminId}`)
      .set(auth(adminToken))
      .send({ role: 'PROPERTY_MANAGER' });
    expect(demoteLastAdminRes.status).toBe(403);
    expect(demoteLastAdminRes.body.message).toContain('最后一位有效管理员');
  });
});
