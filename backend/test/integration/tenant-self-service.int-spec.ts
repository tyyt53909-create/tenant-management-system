import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase, setupTenancy } from './harness.js';

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

describe('租客自助中心与服务全景闭环集成测试（LSE-05 / T297）', () => {
  it('租客总览聚合、自助实名登记认证状态流转与名下收据列表隔离查询', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    // 1. 创建待缴账单
    const billRes = await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'RENT',
        period: '2026-10',
        amount: 300000,
        dueDate: '2026-10-15',
      });
    expect(billRes.status).toBe(201);
    const billId = billRes.body.id;
    const billAmount = billRes.body.amount;

    // 2. 创建工单与通知
    const maintRes = await http(app)
      .post('/maintenance')
      .set(auth(tenancy.tenantToken))
      .send({
        title: '客厅空调漏水',
        category: 'APPLIANCE',
        description: '空调开机半小时后持续滴水',
      });
    expect(maintRes.status).toBe(201);

    const tenantUser = await prisma.user.findFirstOrThrow({
      where: { tenant: { id: tenancy.tenantId } },
    });

    await http(app)
      .post('/notifications')
      .set(auth(tenancy.adminToken))
      .send({
        userId: tenantUser.id,
        title: '租约生效提醒',
        content: '欢迎入住栖居生活空间',
        type: 'CONTRACT',
      });

    // 3. 租客查询自助中心总览数据聚合（GET /api/tenants/me/overview）
    const overviewRes = await http(app)
      .get('/tenants/me/overview')
      .set(auth(tenancy.tenantToken));
    expect(overviewRes.status).toBe(200);
    const ov = overviewRes.body;
    expect(ov.bound).toBe(true);
    expect(ov.tenant.id).toBe(tenancy.tenantId);
    expect(ov.contract.id).toBe(tenancy.contractId);
    expect(ov.contract.contractNumber).toBeTruthy();
    expect(ov.contract.daysRemaining).toBeGreaterThan(0);
    expect(ov.bills.pendingCount).toBe(1);
    expect(ov.bills.pendingAmount).toBe(billAmount);
    expect(ov.bills.pendingAmountYuan).toBe((billAmount / 100).toFixed(2));
    expect(ov.maintenance.activeCount).toBe(1);
    expect(ov.unreadNotificationsCount).toBeGreaterThanOrEqual(1);
    expect(ov.registration.status).toBe('NOT_REGISTERED');

    // 4. 租客查询本人实名登记状态（未登记时不报错，返回 NOT_REGISTERED）
    const initialRegRes = await http(app)
      .get('/tenants/me/registration')
      .set(auth(tenancy.tenantToken));
    expect(initialRegRes.status).toBe(200);
    expect(initialRegRes.body.status).toBe('NOT_REGISTERED');
    expect(initialRegRes.body.idNumberMasked).toBeNull();

    // 5. 租客自助提交实名登记（POST /api/tenants/me/registration）
    const plainIdNumber = '110101199001011234';
    const submitRegRes = await http(app)
      .post('/tenants/me/registration')
      .set(auth(tenancy.tenantToken))
      .send({
        idType: 'ID_CARD',
        idNumber: plainIdNumber,
        realName: '租客真实姓名',
        emergencyContact: '紧急联系人李某',
        emergencyPhone: '13811112222',
      });
    expect(submitRegRes.status).toBe(201);
    expect(submitRegRes.body.message).toContain('提交成功');
    expect(submitRegRes.body.registration.status).toBe('PENDING');
    expect(submitRegRes.body.registration.idNumberMasked).toBe('1101**********1234');
    expect(JSON.stringify(submitRegRes.body)).not.toContain(plainIdNumber);

    // 数据库断言：证件号被加密、哈希索引已建立、记录审计
    const dbReg = await prisma.tenantRegistration.findUnique({
      where: { tenantId: tenancy.tenantId },
    });
    expect(dbReg).not.toBeNull();
    expect(dbReg?.status).toBe('PENDING');
    expect(dbReg?.idNumber).not.toBe(plainIdNumber);
    expect(dbReg?.idNumberHash).toBeTruthy();

    const auditSubmit = await prisma.auditLog.findFirst({
      where: { action: 'SUBMIT_TENANT_REGISTRATION', entityType: 'TenantRegistration' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditSubmit).not.toBeNull();
    expect(JSON.stringify(auditSubmit?.changes)).not.toContain(plainIdNumber);

    // 租客再次查询本人实名登记（GET /api/tenants/me/registration）为 PENDING
    const pendingRegRes = await http(app)
      .get('/tenants/me/registration')
      .set(auth(tenancy.tenantToken));
    expect(pendingRegRes.status).toBe(200);
    expect(pendingRegRes.body.status).toBe('PENDING');
    expect(pendingRegRes.body.idNumberMasked).toBe('1101**********1234');

    // 6. 管理员审核通过实名登记（状态置为 REGISTERED）
    const approveRes = await http(app)
      .put(`/tenants/${tenancy.tenantId}/registration`)
      .set(auth(tenancy.adminToken))
      .send({
        idType: 'ID_CARD',
        status: 'REGISTERED',
      });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('REGISTERED');

    // 已 REGISTERED 状态下，租客禁止私自改动实名认证
    const reSubmitRes = await http(app)
      .post('/tenants/me/registration')
      .set(auth(tenancy.tenantToken))
      .send({
        idType: 'ID_CARD',
        idNumber: '110101199001019999',
      });
    expect(reSubmitRes.status).toBe(409);

    // 7. 账单收款并出具电子收据
    const payRes = await http(app)
      .post(`/bills/${billId}/payments`)
      .set(auth(tenancy.adminToken))
      .send({
        amount: billAmount,
        paymentMethod: 'WECHAT',
        transactionNumber: 'WX_TRX_LSE05_001',
      });
    expect(payRes.status).toBe(201);
    const receiptNumber = payRes.body.payment.receiptNumber;
    expect(receiptNumber).toBeTruthy();

    // 8. 租客查询名下所有电子收据列表（GET /api/bills/my/receipts）
    const myReceiptsRes = await http(app)
      .get('/bills/my/receipts')
      .set(auth(tenancy.tenantToken));
    expect(myReceiptsRes.status).toBe(200);
    expect(Array.isArray(myReceiptsRes.body)).toBe(true);
    expect(myReceiptsRes.body.length).toBe(1);
    const item = myReceiptsRes.body[0];
    expect(item.receiptNumber).toBe(receiptNumber);
    expect(item.amount).toBe(billAmount);
    expect(item.amountYuan).toBe((billAmount / 100).toFixed(2));
    expect(item.paymentMethod).toBe('WECHAT');
    expect(item.isVoided).toBe(false);
    expect(item.verifyCode).toHaveLength(16);

    // 9. 隔离测试：第二个租客不能在 GET /api/bills/my/receipts 看到第一个租客的收据
    const secondUserPwd = 'Tenant@123';
    const pwdHash = await bcrypt.hash(secondUserPwd, 4);
    await prisma.user.create({
      data: {
        email: 'tenant2@example.com',
        passwordHash: pwdHash,
        role: 'TENANT',
        tenant: {
          create: {
            name: '第二个租客',
            phone: '13900009999',
          },
        },
      },
    });
    const secondToken = await login(app, 'tenant2@example.com', secondUserPwd);
    const secondReceiptsRes = await http(app)
      .get('/bills/my/receipts')
      .set(auth(secondToken));
    expect(secondReceiptsRes.status).toBe(200);
    expect(secondReceiptsRes.body).toEqual([]);
  });
});
