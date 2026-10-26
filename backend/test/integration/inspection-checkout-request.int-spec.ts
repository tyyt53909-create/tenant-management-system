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

describe('入住退租验房与租客退租申请集成测试（T300 / LSE-03）', () => {
  it('入住验房全生命周期：创建 -> 默认物品模板自愈 -> 读数与照片 -> 租客确认', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '301',
        floor: 3,
        roomType: 'ONE_BED',
        area: 42,
      },
    });

    const tenantUser = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13811112222',
        tenant: {
          create: {
            name: '入住测试租客',
            phone: '13811112222',
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
        contractNumber: `C_INSP_${Date.now()}`,
        rentAmount: 300000,
        depositAmount: 300000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        startDate: new Date('2026-11-01'),
        endDate: new Date('2027-10-31'),
        lateFeeRule: {},
        status: 'ACTIVE',
      },
    });

    // 1. 获取默认验房清单模板
    const templateRes = await http(app)
      .get('/inspections/template-items')
      .set(auth(adminToken));
    expect(templateRes.status).toBe(200);
    expect(templateRes.body.length).toBeGreaterThan(0);

    // 2. 管理员创建入住验房单（不传 items，自动以默认模板填充）
    const createRes = await http(app)
      .post('/inspections')
      .set(auth(adminToken))
      .send({
        type: 'CHECK_IN',
        contractId: contract.id,
        inspectorName: '王管家',
        inspectorPhone: '13900001111',
        meterReadings: { coldWater: 10.5, electric: 150.2 },
        photos: ['/uploads/insp-living-room.jpg'],
        overallNotes: '房屋整洁，家电正常可用',
      });
    expect(createRes.status).toBe(201);
    const inspectionId = createRes.body.id;
    expect(createRes.body.status).toBe('PENDING_CONFIRM');
    expect(createRes.body.items.length).toBeGreaterThan(0);

    // 3. 租客查看本人的入住验房单
    const tenantListRes = await http(app)
      .get('/inspections/my')
      .set(auth(tenantToken));
    expect(tenantListRes.status).toBe(200);
    expect(tenantListRes.body.data.some((i: any) => i.id === inspectionId)).toBe(true);

    const tenantDetailRes = await http(app)
      .get(`/inspections/${inspectionId}`)
      .set(auth(tenantToken));
    expect(tenantDetailRes.status).toBe(200);
    expect(tenantDetailRes.body.meterReadings.coldWater).toBe(10.5);

    // 4. 租客在线确认交付清单并签字
    const confirmRes = await http(app)
      .post(`/inspections/${inspectionId}/confirm`)
      .set(auth(tenantToken))
      .send({
        agree: true,
        tenantNotes: '确认无误，房屋已交接',
        tenantSignature: 'TENANT_SIGNATURE_DATA_BASE64',
      });
    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.status).toBe('CONFIRMED');
    expect(confirmRes.body.tenantConfirmedAt).toBeDefined();

    // 5. 验证已确认的验房单不可随意篡改
    const patchRes = await http(app)
      .patch(`/inspections/${inspectionId}`)
      .set(auth(adminToken))
      .send({ status: 'DRAFT' });
    expect(patchRes.status).toBe(409);
  });

  it('租客自主退租申请生命周期：申请 -> 撤回 -> 重新发起 -> 审批通过并自动生成结算单草稿', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '302',
        floor: 3,
        roomType: 'ONE_BED',
      },
    });

    const tenantUser = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: '13822223333',
        tenant: {
          create: {
            name: '退租申请租客',
            phone: '13822223333',
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
        contractNumber: `C_REQ_${Date.now()}`,
        rentAmount: 280000,
        depositAmount: 280000,
        paymentCycle: 'MONTHLY',
        paymentDay: 1,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        lateFeeRule: {},
        status: 'ACTIVE',
      },
    });

    // 1. 租客发起退租申请
    const applyRes = await http(app)
      .post('/checkout/requests')
      .set(auth(tenantToken))
      .send({
        contractId: contract.id,
        expectedCheckoutDate: '2026-11-30',
        reasonType: 'JOB_TRANSFER',
        reasonDetail: '因公司业务调动前往异地工作',
        refundAccount: {
          type: 'BANK',
          bankName: '招商银行',
          accountNo: '6225888899990000',
          accountName: '退租申请租客',
        },
      });
    expect(applyRes.status).toBe(201);
    const requestId = applyRes.body.id;
    expect(applyRes.body.status).toBe('PENDING');
    expect(applyRes.body.requestNumber).toMatch(/^CR\d+/);

    // 2. 租客撤回申请
    const cancelRes = await http(app)
      .post(`/checkout/requests/${requestId}/cancel`)
      .set(auth(tenantToken));
    expect(cancelRes.status).toBe(201);
    expect(cancelRes.body.status).toBe('CANCELLED');

    // 3. 租客重新发起退租申请
    const reapplyRes = await http(app)
      .post('/checkout/requests')
      .set(auth(tenantToken))
      .send({
        contractId: contract.id,
        expectedCheckoutDate: '2026-12-15',
        reasonType: 'EARLY_TERMINATION',
        reasonDetail: '个人原因提前退租',
      });
    expect(reapplyRes.status).toBe(201);
    const newRequestId = reapplyRes.body.id;

    // 4. 管理员查看申请列表
    const adminListRes = await http(app)
      .get('/checkout/requests?status=PENDING')
      .set(auth(adminToken));
    expect(adminListRes.status).toBe(200);
    expect(adminListRes.body.data.some((r: any) => r.id === newRequestId)).toBe(true);

    // 5. 管理员审批通过退租申请
    const reviewRes = await http(app)
      .post(`/checkout/requests/${newRequestId}/review`)
      .set(auth(adminToken))
      .send({ approved: true });
    expect(reviewRes.status).toBe(201);
    expect(reviewRes.body.status).toBe('APPROVED');
    const checkoutRecordId = reviewRes.body.checkoutRecordId;
    expect(checkoutRecordId).toBeDefined();

    // 6. 验证生成的退租结算单草稿
    const checkoutDetailRes = await http(app)
      .get(`/checkout/${checkoutRecordId}`)
      .set(auth(adminToken));
    expect(checkoutDetailRes.status).toBe(200);
    expect(checkoutDetailRes.body.status).toBe('DRAFT');
    expect(checkoutDetailRes.body.contractId).toBe(contract.id);
  });

  it('退租验房 (CHECK_OUT) 发现设施损坏与扣款联动', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: '303',
        floor: 3,
        roomType: 'ONE_BED',
      },
    });

    const tenant = await prisma.tenant.create({
      data: { name: '扣款测试租客', phone: '13833334444' },
    });

    const contract = await prisma.contract.create({
      data: {
        buildingId: base.buildingId,
        roomId: room.id,
        tenantId: tenant.id,
        contractNumber: `C_DMG_${Date.now()}`,
        rentAmount: 300000,
        depositAmount: 300000,
        paymentCycle: 'MONTHLY',
        paymentDay: 1,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        lateFeeRule: {},
        status: 'ACTIVE',
      },
    });

    // 1. 创建退租交接验房单，记录损坏项与维修赔偿金
    const outInspRes = await http(app)
      .post('/inspections')
      .set(auth(adminToken))
      .send({
        type: 'CHECK_OUT',
        contractId: contract.id,
        inspectorName: '李主管',
        meterReadings: { coldWater: 45.8, electric: 680.0 },
        items: [
          { name: '房屋钥匙', status: 'INTACT', quantity: 2 },
          {
            name: '墙面及壁纸',
            status: 'DAMAGED',
            damageDescription: '卧室大面积油画涂鸦损坏',
            repairCost: 50000, // 500 元
          },
        ],
      });
    expect(outInspRes.status).toBe(201);
    const outInspId = outInspRes.body.id;

    // 2. 创建退租单并关联合同与验房单
    const checkoutRes = await http(app)
      .post('/checkout')
      .set(auth(adminToken))
      .send({
        contractId: contract.id,
        roomId: room.id,
        checkoutDate: '2026-11-01',
        totalRefund: 250000,
        processedBy: '李主管',
        inspectionId: outInspId,
        items: [
          {
            itemType: 'DEPOSIT_REFUND',
            description: '押金应退',
            amount: 300000,
          },
          {
            itemType: 'DEPOSIT_DEDUCTION',
            description: '依据退租验房单：卧室墙面损坏扣费',
            amount: 50000,
          },
        ],
      });
    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.items).toHaveLength(2);

    // 3. 查询验房单验证与退租单已建立双向关联
    const inspDetail = await http(app)
      .get(`/inspections/${outInspId}`)
      .set(auth(adminToken));
    expect(inspDetail.status).toBe(200);
    expect(inspDetail.body.checkoutRecords.some((c: any) => c.id === checkoutRes.body.id)).toBe(true);
  });
});
