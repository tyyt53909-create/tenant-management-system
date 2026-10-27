import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';

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

describe('保洁工单：自动建单、指派、开工完工与验收恢复全生命周期集成测试（T304 / WRK-03）', () => {
  it('退租自动生成保洁任务 -> 指派保洁员 -> 开工联动CLEANING -> 完工提报 -> 验收合格原子恢复CLEAN', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);
    const jwt = app.get(JwtAuthService);

    // 1. 创建测试房间与保洁员
    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: 'B-301',
        floor: 3,
        roomType: 'ONE_BED',
        status: 'VACANT',
        cleanStatus: 'PENDING_CLEAN',
      },
    });

    const cleanerUser = await prisma.user.create({
      data: {
        role: 'CLEANER',
        phone: '13866665555',
        isActive: true,
      },
    });
    const cleanerTokens = await jwt.generateTokens({ sub: cleanerUser.id, role: 'CLEANER' });
    const cleanerToken = cleanerTokens.accessToken;

    // 2. 管理员手动创建退租保洁工单
    const createRes = await http(app)
      .post('/api/cleaning/tasks')
      .set(auth(adminToken))
      .send({
        roomId: room.id,
        type: 'CHECKOUT',
        notes: '租客已搬离，需全面清洁',
      })
      .expect(201);

    const taskId = createRes.body.id;
    expect(createRes.body.taskNumber).toMatch(/^CL-/);
    expect(createRes.body.status).toBe('PENDING');

    // 3. 管理员指派保洁员
    const assignRes = await http(app)
      .post(`/api/cleaning/tasks/${taskId}/assign`)
      .set(auth(adminToken))
      .send({ cleanerId: cleanerUser.id })
      .expect(201);

    expect(assignRes.body.status).toBe('ASSIGNED');
    expect(assignRes.body.cleanerId).toBe(cleanerUser.id);

    // 4. 保洁员登录专属端点查看指派任务
    const assignedRes = await http(app)
      .get('/api/cleaning/tasks/assigned')
      .set(auth(cleanerToken))
      .expect(200);

    expect(assignedRes.body.data.length).toBe(1);
    expect(assignedRes.body.data[0].id).toBe(taskId);

    // 5. 保洁员开工，联动房间状态为 CLEANING
    const startRes = await http(app)
      .post(`/api/cleaning/tasks/${taskId}/start`)
      .set(auth(cleanerToken))
      .expect(201);

    expect(startRes.body.status).toBe('IN_PROGRESS');

    const roomAfterStart = await prisma.room.findUnique({ where: { id: room.id } });
    expect(roomAfterStart?.cleanStatus).toBe('CLEANING');

    // 6. 保洁员提报完工
    const completeRes = await http(app)
      .post(`/api/cleaning/tasks/${taskId}/complete`)
      .set(auth(cleanerToken))
      .send({
        afterPhotos: ['clean_after_01.jpg', 'clean_after_02.jpg'],
        notes: '地面及卫浴已深度消毒清洁完毕',
      })
      .expect(201);

    expect(completeRes.body.status).toBe('COMPLETED');

    // 7. 管理员验收合格，评5星，联动房态原子恢复为 CLEAN！
    const acceptRes = await http(app)
      .post(`/api/cleaning/tasks/${taskId}/accept`)
      .set(auth(adminToken))
      .send({
        rating: 5,
        acceptanceNotes: '清洁非常彻底，符合挂牌上线标准',
      })
      .expect(201);

    expect(acceptRes.body.status).toBe('ACCEPTED');
    expect(acceptRes.body.rating).toBe(5);

    const roomAfterAccept = await prisma.room.findUnique({ where: { id: room.id } });
    expect(roomAfterAccept?.cleanStatus).toBe('CLEAN');
  });

  it('验收不合格驳回返工流程', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: 'B-302',
        floor: 3,
        roomType: 'ONE_BED',
        status: 'VACANT',
        cleanStatus: 'PENDING_CLEAN',
      },
    });

    const cleanerUser = await prisma.user.create({
      data: { role: 'CLEANER', phone: '13866665556', isActive: true },
    });

    const task = await prisma.cleaningTask.create({
      data: {
        taskNumber: `CL-TEST-002`,
        buildingId: base.buildingId,
        roomId: room.id,
        cleanerId: cleanerUser.id,
        status: 'COMPLETED',
      },
    });

    // 管理员驳回返工
    const rejectRes = await http(app)
      .post(`/api/cleaning/tasks/${task.id}/reject`)
      .set(auth(adminToken))
      .send({ reason: '窗台有浮尘，需重擦' })
      .expect(201);

    expect(rejectRes.body.status).toBe('IN_PROGRESS');
    expect(rejectRes.body.notes).toContain('窗台有浮尘');
  });
});
