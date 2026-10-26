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

describe('维修工单：派工、SLA、员工端与费用转嫁集成测试（T303 / WRK-02）', () => {
  it('工单报修、派工调度、维修工接单完工、租客验收与过失费用转嫁全闭环', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);
    const jwt = app.get(JwtAuthService);

    // 0. 创建测试房源与租客及生效合同
    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: 'A-201',
        floor: 2,
        roomType: 'ONE_BED',
        status: 'OCCUPIED',
      },
    });

    const tenantUser = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13988887777',
        tenant: {
          create: {
            name: '工单测试租客',
            phone: '13988887777',
          },
        },
      },
      include: { tenant: true },
    });
    const tenantId = tenantUser.tenant!.id;

    const tenantTokens = await jwt.generateTokens({ sub: tenantUser.id, role: 'TENANT' });
    const tenantToken = tenantTokens.accessToken;

    const contract = await prisma.contract.create({
      data: {
        buildingId: base.buildingId,
        roomId: room.id,
        tenantId,
        contractNumber: `C_MAINT_${Date.now()}`,
        rentAmount: 300000,
        depositAmount: 300000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'ACTIVE',
        lateFeeRule: {},
      },
    });

    // 1. 创建维修师傅账号 (MAINTAINER)
    const createMaintainerRes = await http(app)
      .post('/staff')
      .set(auth(adminToken))
      .send({
        email: 'master-zhang@example.com',
        password: '{{SECRET_v4l5a610}}',
        phone: '13900008888',
        role: 'MAINTAINER',
      });
    expect(createMaintainerRes.status).toBe(201);
    const maintainerId = createMaintainerRes.body.id;

    // 维修师傅凭证
    const maintainerTokens = await jwt.generateTokens({ sub: maintainerId, role: 'MAINTAINER' });
    const maintainerToken = maintainerTokens.accessToken;

    // 2. 租客提交紧急报修工单 (URGENT)
    const createReqRes = await http(app)
      .post('/maintenance')
      .set(auth(tenantToken))
      .send({
        title: '卫生间角阀爆裂漏水',
        description: '角阀断裂导致卫生间积水严重，已关总阀',
        category: 'PLUMBING',
        priority: 'URGENT',
      });
    expect(createReqRes.status).toBe(201);
    const requestId = createReqRes.body.id;
    expect(createReqRes.body.status).toBe('SUBMITTED');
    expect(createReqRes.body.priority).toBe('URGENT');
    expect(createReqRes.body.responseDueAt).toBeDefined();
    expect(createReqRes.body.slaDueAt).toBeDefined();
    expect(createReqRes.body.isSlaBreached).toBe(false);

    // 3. 管理员 / 管家派工给维修师傅 (POST /maintenance/:id/dispatch)
    const dispatchRes = await http(app)
      .post(`/maintenance/${requestId}/dispatch`)
      .set(auth(adminToken))
      .send({
        assignedMaintainerId: maintainerId,
        assignedTo: '张师傅（金牌电工）',
        notes: '紧急工单，请于30分钟内联系租客并携带DN15角阀',
      });
    expect(dispatchRes.status).toBe(201);
    expect(dispatchRes.body.status).toBe('ASSIGNED');
    expect(dispatchRes.body.assignedMaintainerId).toBe(maintainerId);
    expect(dispatchRes.body.assignedTo).toBe('张师傅（金牌电工）');
    expect(dispatchRes.body.firstRespondedAt).toBeDefined();

    // 4. 维修师傅查看指派给本人的工单列表 (GET /maintenance/assigned)
    const assignedListRes = await http(app)
      .get('/maintenance/assigned')
      .set(auth(maintainerToken));
    expect(assignedListRes.status).toBe(200);
    expect(assignedListRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(assignedListRes.body.data.some((item: any) => item.id === requestId)).toBe(true);

    // 5. 维修师傅接单开工 (POST /maintenance/:id/start)
    const startRes = await http(app)
      .post(`/maintenance/${requestId}/start`)
      .set(auth(maintainerToken))
      .send({ notes: '已到现场，正在拆卸损坏旧角阀' });
    expect(startRes.status).toBe(201);
    expect(startRes.body.status).toBe('IN_PROGRESS');

    // 6. 维修师傅提报完工与用料成本，判定租客过失责任 (POST /maintenance/:id/complete)
    const completeRes = await http(app)
      .post(`/maintenance/${requestId}/complete`)
      .set(auth(maintainerToken))
      .send({
        resolution: '更换加厚铜芯角阀，管道打胶密封，试压正常',
        laborCost: 4000, // 40.00 元
        materialCost: 6000, // 60.00 元
        tenantFault: true,
        faultReason: '租客私自安装增压喷枪导致螺纹受外力硬撬断裂',
      });
    expect(completeRes.status).toBe(201);
    expect(completeRes.body.status).toBe('PENDING_CONFIRM');
    expect(completeRes.body.laborCost).toBe(4000);
    expect(completeRes.body.materialCost).toBe(6000);
    expect(completeRes.body.totalCost).toBe(10000);
    expect(completeRes.body.tenantFault).toBe(true);

    // 7. 租客验收确认通过 (POST /maintenance/:id/confirm)
    const confirmRes = await http(app)
      .post(`/maintenance/${requestId}/confirm`)
      .set(auth(tenantToken))
      .send({
        accepted: true,
        feedback: '张师傅修得很快，测水无滴漏',
        rating: 5,
      });
    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.status).toBe('COMPLETED');
    expect(confirmRes.body.resolvedAt).toBeDefined();

    // 8. 管理员执行费用转嫁，生成租客账单 (POST /maintenance/:id/transfer-expense)
    const transferRes = await http(app)
      .post(`/maintenance/${requestId}/transfer-expense`)
      .set(auth(adminToken))
      .send({
        dueDate: '2026-11-05',
        notes: '租客过失角阀维修费转嫁',
      });
    expect(transferRes.status).toBe(201);
    expect(transferRes.body.bill).toBeDefined();
    expect(transferRes.body.bill.billType).toBe('MAINTENANCE');
    expect(transferRes.body.bill.amount).toBe(10000);
    expect(transferRes.body.bill.dedupKey).toBe(`MAINTENANCE:${requestId}`);
    expect(transferRes.body.maintenanceRequest.expenseTransferred).toBe(true);
    expect(transferRes.body.maintenanceRequest.expenseBillId).toBe(transferRes.body.bill.id);

    // 重复转嫁应被拒绝（409 Conflict）
    const repeatTransferRes = await http(app)
      .post(`/maintenance/${requestId}/transfer-expense`)
      .set(auth(adminToken))
      .send({});
    expect(repeatTransferRes.status).toBe(409);

    // 9. 验证生成的账单在租客账单列表中可见且正确关联
    const billsRes = await http(app)
      .get(`/bills?contractId=${contract.id}`)
      .set(auth(adminToken));
    expect(billsRes.status).toBe(200);
    const maintenanceBill = billsRes.body.data.find(
      (b: any) => b.id === transferRes.body.bill.id,
    );
    expect(maintenanceBill).toBeDefined();
    expect(maintenanceBill.billType).toBe('MAINTENANCE');
    expect(maintenanceBill.amount).toBe(10000);

    // 10. SLA 超时监控与告警验证 (GET /maintenance/sla-alerts)
    const pastDate = new Date(Date.now() - 5 * 3600 * 1000); // 5 小时前（URGENT 响应死线为 2 小时）
    const overdueReq = await prisma.maintenanceRequest.create({
      data: {
        roomId: room.id,
        tenantId,
        title: '入户门锁无法上锁',
        description: '无法闭锁',
        category: 'DOOR_WINDOW',
        priority: 'URGENT',
        status: 'SUBMITTED',
        createdAt: pastDate,
        responseDueAt: new Date(pastDate.getTime() + 2 * 3600 * 1000),
        slaDueAt: new Date(pastDate.getTime() + 24 * 3600 * 1000),
        isSlaBreached: false,
      },
    });

    const slaAlertsRes = await http(app)
      .get('/maintenance/sla-alerts')
      .set(auth(adminToken));
    expect(slaAlertsRes.status).toBe(200);
    expect(slaAlertsRes.body.alerts.some((a: any) => a.id === overdueReq.id)).toBe(true);

    const checkUpdated = await prisma.maintenanceRequest.findUnique({
      where: { id: overdueReq.id },
    });
    expect(checkUpdated?.isSlaBreached).toBe(true);
    expect(checkUpdated?.slaBreachType).toBe('RESPONSE_OVERDUE');
  });
});
