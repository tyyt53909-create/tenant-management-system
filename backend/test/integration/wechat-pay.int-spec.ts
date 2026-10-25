import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../src/modules/bills/payment/payment-provider.js';
import { MockPaymentProvider } from '../../src/modules/bills/payment/mock-payment.provider.js';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';

let app: INestApplication;
let mockPaymentProvider: MockPaymentProvider;

process.env.WECHAT_PAY_MOCK = 'true';

beforeAll(async () => {
  app = await createApp();
  mockPaymentProvider = app.get<PaymentProvider>(PAYMENT_PROVIDER) as MockPaymentProvider;
}, 30_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  mockPaymentProvider.clear();
});

describe('微信支付 JSAPI 收款整合测试（T293 / PAY-01 / DEC-04）', () => {
  async function setupTenantWithContract(params: {
    roomNumber: string;
    tenantName: string;
    phone: string;
    openid: string;
    base?: any;
    adminToken?: string;
  }) {
    const base = params.base || (await seedBase());
    const adminToken =
      params.adminToken || (await login(app, base.adminEmail, base.adminPassword));

    // 1. 创建租客用户与身份
    const userRes = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: params.phone,
        isActive: true,
      },
    });

    await prisma.userIdentity.create({
      data: {
        userId: userRes.id,
        provider: 'WECHAT_MP',
        providerUserId: params.openid,
      },
    });

    const tenantRes = await http(app)
      .post('/tenants')
      .set(auth(adminToken))
      .send({
        name: params.tenantName,
        phone: params.phone,
      });
    expect(tenantRes.status).toBe(201);
    const tenantId = tenantRes.body.id;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { userId: userRes.id },
    });

    // 2. 创建房间与合同
    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: params.roomNumber,
        floor: 1,
        roomType: 'ONE_BED',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        contractNumber: `CT-${params.roomNumber}`,
        buildingId: base.buildingId,
        roomId: room.id,
        tenantId,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2027-09-30'),
        rentAmount: 300000,
        depositAmount: 300000,
        paymentCycle: 'MONTHLY',
        paymentDay: 1,
        lateFeeRule: {},
        status: 'ACTIVE',
      },
    });

    // 3. 创建账单
    const bill = await prisma.bill.create({
      data: {
        contractId: contract.id,
        billNumber: `BILL-${params.roomNumber}-01`,
        billType: 'RENT',
        period: '2026-10',
        amount: 300000,
        paidAmount: 0,
        dueDate: new Date('2026-10-15'),
        status: 'PENDING',
        snapshot: {},
      },
    });

    // 签发租客 JWT
    const jwtService = app.get(JwtAuthService);
    const tokens = await jwtService.generateTokens({
      sub: userRes.id,
      role: 'TENANT',
    });

    return {
      adminToken,
      tenantToken: tokens.accessToken,
      userId: userRes.id,
      tenantId,
      billId: bill.id,
      contractId: contract.id,
      room,
    };
  }

  it('租客越权防护：租客 A 尝试支付租客 B 的账单被 403 拒绝', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const tenantA = await setupTenantWithContract({
      roomNumber: '101',
      tenantName: '租客A',
      phone: '13800000001',
      openid: 'openid_a',
      base,
      adminToken,
    });

    const tenantB = await setupTenantWithContract({
      roomNumber: '102',
      tenantName: '租客B',
      phone: '13800000002',
      openid: 'openid_b',
      base,
      adminToken,
    });

    // 租客 A 尝试支付租客 B 的账单
    const res = await http(app)
      .post(`/bills/${tenantB.billId}/pay/wechat-jsapi`)
      .set(auth(tenantA.tenantToken))
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('无权支付');
  });

  it('租客发起微信支付 JSAPI 下单成功，获得小程序调起参数', async () => {
    const tenant = await setupTenantWithContract({
      roomNumber: '201',
      tenantName: '李四',
      phone: '13800000003',
      openid: 'wx_openid_lisi',
    });

    const res = await http(app)
      .post(`/bills/${tenant.billId}/pay/wechat-jsapi`)
      .set(auth(tenant.tenantToken))
      .send({ amount: 300000 });

    expect(res.status).toBe(201);
    expect(res.body.appId).toBe('wx_mock_appid');
    expect(res.body.package).toContain('prepay_id=mock_prepay_');
    expect(res.body.signType).toBe('RSA');
    expect(res.body.outTradeNo).toMatch(/^WP_/);

    const stored = mockPaymentProvider.getOrder(res.body.outTradeNo);
    expect(stored?.amount).toBe(300000);
    expect(stored?.openid).toBe('wx_openid_lisi');
  });

  it('微信支付异步通知回调驱动入账，且重复回调保持幂等', async () => {
    const tenant = await setupTenantWithContract({
      roomNumber: '301',
      tenantName: '王五',
      phone: '13800000004',
      openid: 'wx_openid_wangwu',
    });

    // 1. 发起下单
    const payRes = await http(app)
      .post(`/bills/${tenant.billId}/pay/wechat-jsapi`)
      .set(auth(tenant.tenantToken))
      .send();
    expect(payRes.status).toBe(201);
    const outTradeNo = payRes.body.outTradeNo;

    // 2. 模拟微信支付服务器回调推送
    const notifyPayload = {
      out_trade_no: outTradeNo,
      transaction_id: '420000202610250001',
      amount: { total: 300000 },
      payer: { openid: 'wx_openid_wangwu' },
      attach: JSON.stringify({ billId: tenant.billId, userId: tenant.userId }),
    };

    const notifyRes1 = await http(app)
      .post('/payments/wechat/notify')
      .send(notifyPayload);

    expect(notifyRes1.status).toBe(200);
    expect(notifyRes1.body.code).toBe('SUCCESS');

    // 3. 验证账单状态已更新为 PAID
    const billAfter = await prisma.bill.findUnique({
      where: { id: tenant.billId },
      include: { paymentRecords: true },
    });
    expect(billAfter?.status).toBe('PAID');
    expect(billAfter?.paidAmount).toBe(300000);
    expect(billAfter?.paymentRecords).toHaveLength(1);
    expect(billAfter?.paymentRecords[0].transactionNumber).toBe('420000202610250001');
    expect(billAfter?.paymentRecords[0].paymentMethod).toBe('WECHAT');
    expect(billAfter?.paymentRecords[0].receiptNumber).toMatch(/^R\d+/);

    // 4. 重复推送相同通知，保持幂等性，不产生第二笔付款
    const notifyRes2 = await http(app)
      .post('/payments/wechat/notify')
      .send(notifyPayload);

    expect(notifyRes2.status).toBe(200);
    expect(notifyRes2.body.code).toBe('SUCCESS');

    const billRepeat = await prisma.bill.findUnique({
      where: { id: tenant.billId },
      include: { paymentRecords: true },
    });
    expect(billRepeat?.paymentRecords).toHaveLength(1);
  });

  it('押金账单微信支付：同步触发押金台账联动记账（FIN-03）', async () => {
    const tenant = await setupTenantWithContract({
      roomNumber: '401',
      tenantName: '赵六',
      phone: '13800000005',
      openid: 'wx_openid_zhaoliu',
    });

    // 创建押金账单与台账
    const depositBill = await prisma.bill.create({
      data: {
        contractId: tenant.contractId,
        billNumber: 'DEPOSIT-401',
        billType: 'DEPOSIT',
        period: '2026-10',
        amount: 300000,
        paidAmount: 0,
        dueDate: new Date('2026-10-15'),
        status: 'PENDING',
        snapshot: {},
      },
    });

    await prisma.depositLedger.create({
      data: {
        contractId: tenant.contractId,
        tenantId: tenant.tenantId,
        roomId: tenant.room.id,
        amount: 300000,
        balance: 0,
        status: 'HELD',
      },
    });

    // 调起并支付押金账单
    const payRes = await http(app)
      .post(`/bills/${depositBill.id}/pay/wechat-jsapi`)
      .set(auth(tenant.tenantToken))
      .send();
    expect(payRes.status).toBe(201);
    const outTradeNo = payRes.body.outTradeNo;

    // 回调通知
    const notifyRes = await http(app)
      .post('/payments/wechat/notify')
      .send({
        out_trade_no: outTradeNo,
        transaction_id: '420000202610250002',
        amount: { total: 300000 },
        payer: { openid: 'wx_openid_zhaoliu' },
        attach: JSON.stringify({ billId: depositBill.id }),
      });
    expect(notifyRes.status).toBe(200);

    // 验证押金台账余额已同步更新为 300000 分
    const ledger = await prisma.depositLedger.findUnique({
      where: { contractId: tenant.contractId },
      include: { transactions: true },
    });
    expect(ledger?.balance).toBe(300000);
    expect(ledger?.transactions).toHaveLength(1);
    expect(ledger?.transactions[0].type).toBe('COLLECT');
    expect(ledger?.transactions[0].amount).toBe(300000);
  });

  it('主动查单补单：微信端已支付但未收到回调时，通过 wechat-query 端点自动补入账', async () => {
    const tenant = await setupTenantWithContract({
      roomNumber: '501',
      tenantName: '钱七',
      phone: '13800000006',
      openid: 'wx_openid_qianqi',
    });

    // 1. 发起下单
    const payRes = await http(app)
      .post(`/bills/${tenant.billId}/pay/wechat-jsapi`)
      .set(auth(tenant.tenantToken))
      .send();
    expect(payRes.status).toBe(201);
    const outTradeNo = payRes.body.outTradeNo;

    // 2. 模拟用户在微信端已支付完成，但在回调到达系统前租客返回了小程序
    mockPaymentProvider.simulateSuccess(outTradeNo, '420000202610250003');

    // 3. 租客调用 wechat-query 查单端点
    const queryRes = await http(app)
      .post(`/bills/${tenant.billId}/pay/wechat-query`)
      .set(auth(tenant.tenantToken))
      .send({ outTradeNo });

    expect(queryRes.status).toBe(201);
    expect(queryRes.body.synced).toBe(true);
    expect(queryRes.body.order.status).toBe('SUCCESS');
    expect(queryRes.body.bill.status).toBe('PAID');
    expect(queryRes.body.bill.paidAmount).toBe(300000);
  });
});
