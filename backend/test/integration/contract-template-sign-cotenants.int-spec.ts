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

describe('合同模板、PDF、电子签约与共同承租人集成测试（T299 / LSE-02）', () => {
  it('合同模板 CRUD 与默认模板解析', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 1. 获取默认合同模板（系统自愈生成）
    const defaultRes = await http(app)
      .get('/contract-templates/default')
      .set(auth(adminToken));
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.body.code).toBe('STANDARD_RESIDENTIAL');
    expect(defaultRes.body.isDefault).toBe(true);

    // 2. 创建自定义条款模板
    const createRes = await http(app)
      .post('/contract-templates')
      .set(auth(adminToken))
      .send({
        name: '高端合租专属租赁合同模板',
        code: 'LUXURY_CO_LIVING',
        description: '适用于多青年合租、包含公约守则的专用模板',
        content: '高端合租合同：承租人 {tenantName}，合租人 {coTenantsText}，月租 {rentAmountYuan} 元。',
        isDefault: false,
      });
    expect(createRes.status).toBe(201);
    const tmplId = createRes.body.id;

    // 3. 模板列表与编码检索
    const listRes = await http(app)
      .get('/contract-templates?keyword=LUXURY')
      .set(auth(adminToken));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((t: any) => t.id === tmplId)).toBe(true);

    // 4. 更新模板
    const updateRes = await http(app)
      .patch(`/contract-templates/${tmplId}`)
      .set(auth(adminToken))
      .send({ description: '已更新的模板描述' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.description).toBe('已更新的模板描述');
  });

  it('创建合同绑定共同承租人、加密存储与安全脱敏', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    // 创建房源与主租客
    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '701',
        floor: 7,
        roomType: 'TWO_BED',
        area: 65,
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        name: '主承租人张伟',
        phone: '13812345678',
      },
    });

    // 创建合同并传入共同承租人
    const contractRes = await http(app)
      .post('/contracts')
      .set(auth(adminToken))
      .send({
        buildingId: base.buildingId,
        roomId: room.id,
        tenantId: tenant.id,
        rentAmount: 450000,
        depositAmount: 450000,
        paymentCycle: 'MONTHLY',
        paymentDay: 10,
        startDate: '2026-11-01',
        endDate: '2027-10-31',
        coTenants: [
          {
            name: '合租伙伴李雷',
            phone: '13911112222',
            idType: 'ID_CARD',
            idNumber: '110101199501011234',
            relationship: '同事',
            isSigner: true,
          },
        ],
      });
    expect(contractRes.status).toBe(201);
    const contractId = contractRes.body.id;
    expect(contractRes.body.coTenants).toHaveLength(1);
    expect(contractRes.body.coTenants[0].name).toBe('合租伙伴李雷');
    expect(contractRes.body.coTenants[0].idNumber).toBeUndefined(); // 绝不泄露明文
    expect(contractRes.body.coTenants[0].idNumberMasked).toContain('****');

    // 验证数据库底层证件号为加密串
    const dbCoTenant = await prisma.contractCoTenant.findFirst({
      where: { contractId },
    });
    expect(dbCoTenant?.idNumber).not.toBe('110101199501011234');
    expect(dbCoTenant?.idNumber).toContain(':'); // AES-256-GCM 存储格式

    // 追加第二位共同承租人
    const addCoRes = await http(app)
      .post(`/contracts/${contractId}/co-tenants`)
      .set(auth(adminToken))
      .send({
        name: '合租伙伴韩梅梅',
        phone: '13933334444',
        relationship: '朋友',
        isSigner: false,
      });
    expect(addCoRes.status).toBe(201);
    const secondCoId = addCoRes.body.id;

    // 移除第二位共同承租人
    const removeCoRes = await http(app)
      .delete(`/contracts/${contractId}/co-tenants/${secondCoId}`)
      .set(auth(adminToken));
    expect(removeCoRes.status).toBe(200);

    const afterDetail = await http(app)
      .get(`/contracts/${contractId}`)
      .set(auth(adminToken));
    expect(afterDetail.body.coTenants).toHaveLength(1);
  });

  it('规范合同 PDF 导出与防伪验真', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '801',
        floor: 8,
        roomType: 'ONE_BED',
        area: 40,
      },
    });

    const tenantUser = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13788889999',
        tenant: {
          create: {
            name: 'PDF测试承租人',
            phone: '13788889999',
          },
        },
      },
      include: { tenant: true },
    });
    const tenantId = tenantUser.tenant!.id;

    const jwtService = app.get(JwtAuthService);
    const tenantToken = (
      await jwtService.generateTokens({ sub: tenantUser.id, role: 'TENANT' })
    ).accessToken;

    const contract = await prisma.contract.create({
      data: {
        buildingId: base.buildingId,
        roomId: room.id,
        tenantId,
        contractNumber: `C_PDF_${Date.now()}`,
        rentAmount: 320000,
        depositAmount: 320000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        startDate: new Date('2026-11-01'),
        endDate: new Date('2027-10-31'),
        lateFeeRule: {},
        status: 'ACTIVE',
      },
    });

    // 1. 管理员下载 PDF
    const adminPdfRes = await http(app)
      .get(`/contracts/${contract.id}/pdf`)
      .set(auth(adminToken));
    expect(adminPdfRes.status).toBe(200);
    expect(adminPdfRes.headers['content-type']).toBe('application/pdf');
    expect(adminPdfRes.body.slice(0, 8).toString('utf-8')).toContain('%PDF-1.4');

    // 2. 租客下载本人的合同 PDF
    const tenantPdfRes = await http(app)
      .get(`/contracts/${contract.id}/pdf`)
      .set(auth(tenantToken));
    expect(tenantPdfRes.status).toBe(200);
    expect(tenantPdfRes.headers['content-type']).toBe('application/pdf');

    // 3. 其他租客越权下载他人合同 PDF 被拒绝（403）
    const otherUser = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13700009999',
        tenant: { create: { name: '其他租客', phone: '13700009999' } },
      },
      include: { tenant: true },
    });
    const otherToken = (
      await jwtService.generateTokens({ sub: otherUser.id, role: 'TENANT' })
    ).accessToken;

    const breachRes = await http(app)
      .get(`/contracts/${contract.id}/pdf`)
      .set(auth(otherToken));
    expect(breachRes.status).toBe(403);
  });

  it('第三方电子签约生命周期：发起签约 -> 状态查询 -> 回调完成并归档存证', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '901',
        floor: 9,
        roomType: 'ONE_BED',
      },
    });

    const tenantUser = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13612345678',
        tenant: {
          create: {
            name: '签约租客小陈',
            phone: '13612345678',
          },
        },
      },
      include: { tenant: true },
    });
    const tenantId = tenantUser.tenant!.id;
    const jwtService = app.get(JwtAuthService);
    const tenantToken = (
      await jwtService.generateTokens({ sub: tenantUser.id, role: 'TENANT' })
    ).accessToken;

    const contract = await prisma.contract.create({
      data: {
        buildingId: base.buildingId,
        roomId: room.id,
        tenantId,
        contractNumber: `C_SIGN_${Date.now()}`,
        rentAmount: 260000,
        depositAmount: 260000,
        paymentCycle: 'MONTHLY',
        paymentDay: 1,
        startDate: new Date('2026-11-01'),
        endDate: new Date('2027-10-31'),
        lateFeeRule: {},
        status: 'DRAFT',
        signStatus: 'UNSIGNED',
      },
    });

    // 1. 管理员发起电子签约
    const initiateRes = await http(app)
      .post(`/contracts/${contract.id}/sign/initiate`)
      .set(auth(adminToken));
    expect(initiateRes.status).toBe(201);
    expect(initiateRes.body.signStatus).toBe('SIGNING');
    const flowId = initiateRes.body.flowId;
    expect(flowId).toBeDefined();
    expect(initiateRes.body.signUrl).toContain(flowId);

    // 2. 租客查询签约状态
    const statusRes = await http(app)
      .get(`/contracts/${contract.id}/sign/status`)
      .set(auth(tenantToken));
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.signStatus).toBe('SIGNING');
    expect(statusRes.body.flowId).toBe(flowId);

    // 3. 模拟完成签约（支持测试/沙箱端点或外部 Webhook 回调）
    const mockCompleteRes = await http(app)
      .post(`/contracts/${contract.id}/sign/mock-complete`)
      .set(auth(adminToken));
    expect(mockCompleteRes.status).toBe(201);
    expect(mockCompleteRes.body.signStatus).toBe('SIGNED');
    expect(mockCompleteRes.body.signedAt).toBeDefined();

    // 4. 验证附件表中已自动归档已签署 PDF
    const attachments = await prisma.contractAttachment.findMany({
      where: { contractId: contract.id },
    });
    expect(attachments.length).toBeGreaterThanOrEqual(1);
    expect(attachments[0].type).toBe('CONTRACT_SCAN');
    expect(attachments[0].fileUrl).toContain(flowId);

    // 5. 验证公网免登录回调接口
    const callbackRes = await http(app)
      .post('/contracts/sign/callback')
      .send({ flowId, status: 'SIGNED' });
    expect(callbackRes.status).toBe(201);
    expect(callbackRes.body.success).toBe(true);
  });
});
