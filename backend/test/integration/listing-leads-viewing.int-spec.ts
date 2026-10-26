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

describe('招租挂牌、意向线索与看房预约集成测试（T298 / LSE-01）', () => {
  it('房源挂牌状态与公开可租房源列表/详情', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 1. 创建上架房源 (Room 101)
    const room1Res = await http(app)
      .post('/rooms')
      .set(auth(adminToken))
      .send({
        buildingId: base.buildingId,
        roomNumber: '101',
        floor: 1,
        roomType: 'ONE_BED',
        area: 35.5,
        listingPrice: 280000, // 2800 元/月
        isListed: true,
        availableDate: '2026-11-01',
        description: '采光极佳，拎包入住',
      });
    expect(room1Res.status).toBe(201);
    const room1Id = room1Res.body.id;

    // 2. 创建不上架房源 (Room 102)
    const room2Res = await http(app)
      .post('/rooms')
      .set(auth(adminToken))
      .send({
        buildingId: base.buildingId,
        roomNumber: '102',
        floor: 1,
        roomType: 'TWO_BED',
        area: 60,
        listingPrice: 450000,
        isListed: false, // 不对外展示
      });
    expect(room2Res.status).toBe(201);
    const room2Id = room2Res.body.id;

    // 3. 访客免登录查询公开房源列表
    const listRes = await http(app).get('/public/rooms');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((r: any) => r.id === room1Id)).toBe(true);
    expect(listRes.body.data.some((r: any) => r.id === room2Id)).toBe(false); // isListed: false 被过滤

    // 4. 访客按价格区间过滤
    const priceFilterRes = await http(app).get('/public/rooms?minPrice=200000&maxPrice=300000');
    expect(priceFilterRes.status).toBe(200);
    expect(priceFilterRes.body.data.some((r: any) => r.id === room1Id)).toBe(true);

    // 5. 访客免登录查看 101 详情
    const detailRes = await http(app).get(`/public/rooms/${room1Id}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.listingPrice).toBe(280000);
    expect(detailRes.body.roomNumber).toBe('101');

    // 6. 访客获取 101 的标准化微信分享卡片与海报数据
    const shareRes = await http(app).get(`/public/rooms/${room1Id}/share`);
    expect(shareRes.status).toBe(200);
    expect(shareRes.body.title).toContain('101室');
    expect(shareRes.body.priceText).toBe('¥2800.00/月');
    expect(shareRes.body.path).toBe(`/pages/index/index?roomId=${room1Id}`);
  });

  it('意向线索留资与管理员跟进工作台', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '201',
        floor: 2,
        roomType: 'ONE_BED',
        listingPrice: 300000,
        isListed: true,
      },
    });

    // 1. 访客免登录留资
    const leadRes = await http(app)
      .post('/public/leads')
      .send({
        name: '王小二',
        phone: '13811223344',
        roomType: 'ONE_BED',
        budgetMin: 250000,
        budgetMax: 350000,
        source: 'MINIPROGRAM',
        roomId: room.id,
        notes: '希望11月中旬入住',
      });
    expect(leadRes.status).toBe(201);
    const leadId = leadRes.body.id;

    // 2. 验证落库
    const savedLead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(savedLead).not.toBeNull();
    expect(savedLead?.status).toBe('NEW');
    expect(savedLead?.name).toBe('王小二');

    // 3. 租客/访客尝试直接访问内部线索工作台被拒（越权拦截）
    const forbiddenRes = await http(app).get('/leads');
    expect(forbiddenRes.status).toBe(401);

    // 4. 管理员查看线索列表
    const adminListRes = await http(app)
      .get('/leads?status=NEW')
      .set(auth(adminToken));
    expect(adminListRes.status).toBe(200);
    expect(adminListRes.body.data.some((l: any) => l.id === leadId)).toBe(true);

    // 5. 管理员跟进线索，更新为 FOLLOWING 并记录备注
    const updateRes = await http(app)
      .patch(`/leads/${leadId}`)
      .set(auth(adminToken))
      .send({
        status: 'FOLLOWING',
        notes: '已电话沟通，客户对 201 采光很满意，约周末看房',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe('FOLLOWING');

    // 6. 最终签约转化为 CONVERTED
    const convertRes = await http(app)
      .patch(`/leads/${leadId}`)
      .set(auth(adminToken))
      .send({ status: 'CONVERTED' });
    expect(convertRes.status).toBe(200);
    expect(convertRes.body.status).toBe('CONVERTED');
  });

  it('看房预约生命周期：发起预约 -> 排期确认 -> 现场带看完成', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 注册并签发一个租客/访客用户（TENANT 账号要求存在关联的 Tenant 档案）
    const user = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13988776655',
        isActive: true,
        tenant: {
          create: {
            name: '赵六',
            phone: '13988776655',
          },
        },
      },
      include: { tenant: true },
    });
    const jwtService = app.get(JwtAuthService);
    const tokens = await jwtService.generateTokens({
      sub: user.id,
      role: 'TENANT',
    });

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '301',
        floor: 3,
        roomType: 'STUDIO',
        listingPrice: 200000,
        isListed: true,
      },
    });

    // 1. 用户预约看房（未来时间）
    const tomorrow = new Date(Date.now() + 86400000 * 2);
    const appointmentRes = await http(app)
      .post('/public/appointments')
      .set(auth(tokens.accessToken))
      .send({
        roomId: room.id,
        name: '赵六',
        phone: '13988776655',
        appointmentTime: tomorrow.toISOString(),
        visitorsCount: 2,
        notes: '下午有空，方便看房',
      });
    expect(appointmentRes.status).toBe(201);
    const apptId = appointmentRes.body.id;
    expect(appointmentRes.body.status).toBe('PENDING');

    // 2. 租客通过 /appointments/my 查看自己的预约记录
    const myApptsRes = await http(app)
      .get('/appointments/my')
      .set(auth(tokens.accessToken));
    expect(myApptsRes.status).toBe(200);
    expect(myApptsRes.body.some((a: any) => a.id === apptId)).toBe(true);

    // 3. 管理员审核并确认看房排期
    const confirmRes = await http(app)
      .patch(`/appointments/${apptId}/confirm`)
      .set(auth(adminToken))
      .send({ notes: '已安排周六下午2点管家小陈在公寓大堂接待' });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');
    expect(confirmRes.body.confirmedBy).toBeDefined();

    // 4. 现场带看完成，管家录入看房反馈
    const completeRes = await http(app)
      .patch(`/appointments/${apptId}/complete`)
      .set(auth(adminToken))
      .send({ feedback: '客户看房满意，对朝向和租金基本认可，准备走电子合同签约' });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe('COMPLETED');
    expect(completeRes.body.feedback).toContain('电子合同签约');
  });

  it('看房预约取消流转与越权防护', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const userA = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13700000001',
        isActive: true,
        tenant: { create: { name: '租客A', phone: '13700000001' } },
      },
    });
    const userB = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13700000002',
        isActive: true,
        tenant: { create: { name: '租客B', phone: '13700000002' } },
      },
    });
    const jwtService = app.get(JwtAuthService);
    const tokenA = (await jwtService.generateTokens({ sub: userA.id, role: 'TENANT' })).accessToken;
    const tokenB = (await jwtService.generateTokens({ sub: userB.id, role: 'TENANT' })).accessToken;

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '501',
        floor: 5,
        roomType: 'ONE_BED',
        listingPrice: 320000,
        isListed: true,
      },
    });

    // 用户 A 发起预约
    const futureTime = new Date(Date.now() + 86400000 * 3).toISOString();
    const apptRes = await http(app)
      .post('/public/appointments')
      .set(auth(tokenA))
      .send({
        roomId: room.id,
        name: '租客A',
        phone: '13700000001',
        appointmentTime: futureTime,
      });
    const apptId = apptRes.body.id;

    // 用户 B 试图取消用户 A 的预约 -> 403 越权拦截
    const breachRes = await http(app)
      .patch(`/appointments/${apptId}/cancel`)
      .set(auth(tokenB))
      .send({ reason: '恶意取消' });
    expect(breachRes.status).toBe(403);

    // 用户 A 自己取消预约 -> 200 成功
    const cancelRes = await http(app)
      .patch(`/appointments/${apptId}/cancel`)
      .set(auth(tokenA))
      .send({ reason: '临时出差，无法前往看房' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');

    // 已取消的预约再次取消 -> 400 校验拦截
    const dupCancelRes = await http(app)
      .patch(`/appointments/${apptId}/cancel`)
      .set(auth(tokenA))
      .send({ reason: '再次取消' });
    expect(dupCancelRes.status).toBe(400);
  });
});
