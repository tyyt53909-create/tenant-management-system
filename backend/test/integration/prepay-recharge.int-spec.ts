import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../src/modules/bills/payment/payment-provider.js';
import { MockPaymentProvider } from '../../src/modules/bills/payment/mock-payment.provider.js';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';
import { SettingsService } from '../../src/modules/settings/settings.service.js';

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

describe('预付线上充值、自动扣费与可用天数预估整合测试（T296 / PAY-04）', () => {
  async function setupTenantWithPrepay(params: {
    roomNumber: string;
    phone: string;
    openid: string;
    initialBalance?: number;
  }) {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const user = await prisma.user.create({
      data: {
        role: 'TENANT',
        phone: params.phone,
        isActive: true,
      },
    });

    await prisma.userIdentity.create({
      data: {
        userId: user.id,
        provider: 'WECHAT_MP',
        providerUserId: params.openid,
      },
    });

    const tenantRes = await http(app)
      .post('/tenants')
      .set(auth(adminToken))
      .send({
        name: `Tenant-${params.roomNumber}`,
        phone: params.phone,
      });
    expect(tenantRes.status).toBe(201);
    const tenantId = tenantRes.body.id;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { userId: user.id },
    });

    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: params.roomNumber,
        floor: 2,
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
        rentAmount: 250000,
        depositAmount: 250000,
        paymentCycle: 'MONTHLY',
        paymentDay: 1,
        lateFeeRule: {},
        status: 'ACTIVE',
      },
    });

    const prepayAccount = await prisma.prepayAccount.create({
      data: {
        tenantId,
        roomId: room.id,
        balanceCache: params.initialBalance ?? 0,
        lowBalanceThreshold: 5000,
      },
    });

    const jwtService = app.get(JwtAuthService);
    const tokens = await jwtService.generateTokens({
      sub: user.id,
      role: 'TENANT',
    });

    return {
      adminToken,
      adminId: base.adminId,
      tenantToken: tokens.accessToken,
      userId: user.id,
      tenantId,
      prepayAccountId: prepayAccount.id,
      contractId: contract.id,
      roomId: room.id,
    };
  }

  it('租客线上充值：JSAPI 下单 → 微信回调通知 → 幂等入账与流水追溯', async () => {
    const setup = await setupTenantWithPrepay({
      roomNumber: '301',
      phone: '13811112222',
      openid: 'wx_openid_tenant_301',
      initialBalance: 0,
    });

    // 1. 租客发起充值下单（100 元 = 10000 分）
    const orderRes = await http(app)
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .set(auth(setup.tenantToken))
      .send({ amount: 10000 });

    expect(orderRes.status).toBe(201);
    expect(orderRes.body.package).toContain('prepay_id=');
    expect(orderRes.body.outTradeNo).toMatch(/^PR_\d+_[a-f0-9]+$/i);
    const outTradeNo = orderRes.body.outTradeNo;

    // 2. 模拟微信支付成功异步回调通知
    mockPaymentProvider.simulateSuccess(outTradeNo, 'wx_tx_prepay_888');

    const notifyPayload = {
      out_trade_no: outTradeNo,
      transaction_id: 'wx_tx_prepay_888',
      amount: { total: 10000 },
      payer: { openid: 'wx_openid_tenant_301' },
      attach: JSON.stringify({
        purpose: 'PREPAY_RECHARGE',
        prepayAccountId: setup.prepayAccountId,
        userId: setup.userId,
      }),
    };

    const notifyRes = await http(app)
      .post('/payments/wechat/notify')
      .send(notifyPayload);

    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body.code).toBe('SUCCESS');

    // 3. 校验预付余额与流水
    const updatedAccount = await prisma.prepayAccount.findUniqueOrThrow({
      where: { id: setup.prepayAccountId },
      include: { transactions: true },
    });

    expect(updatedAccount.balanceCache).toBe(10000);
    expect(updatedAccount.transactions).toHaveLength(1);
    expect(updatedAccount.transactions[0].type).toBe('RECHARGE');
    expect(updatedAccount.transactions[0].amount).toBe(10000);
    expect(updatedAccount.transactions[0].balanceAfter).toBe(10000);
    expect(updatedAccount.transactions[0].relatedId).toBe('wx_tx_prepay_888');

    // 4. 重复回调通知应幂等放行，不发生二次充值
    const duplicateRes = await http(app)
      .post('/payments/wechat/notify')
      .send(notifyPayload);

    expect(duplicateRes.status).toBe(200);

    const recheckAccount = await prisma.prepayAccount.findUniqueOrThrow({
      where: { id: setup.prepayAccountId },
      include: { transactions: true },
    });
    expect(recheckAccount.balanceCache).toBe(10000);
    expect(recheckAccount.transactions).toHaveLength(1);
  });

  it('租客主动查单同步未回调订单', async () => {
    const setup = await setupTenantWithPrepay({
      roomNumber: '302',
      phone: '13811113333',
      openid: 'wx_openid_tenant_302',
      initialBalance: 2000,
    });

    const orderRes = await http(app)
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .set(auth(setup.tenantToken))
      .send({ amount: 5000 });
    expect(orderRes.status).toBe(201);
    const outTradeNo = orderRes.body.outTradeNo;

    // 模拟微信端已支付完成，但通知丢失
    mockPaymentProvider.simulateSuccess(outTradeNo, 'wx_tx_sync_999');

    // 租客小程序回到前台发起主动同步查单
    const queryRes = await http(app)
      .post('/prepay-accounts/my/recharge/wechat-query')
      .set(auth(setup.tenantToken))
      .send({ outTradeNo });

    expect(queryRes.status).toBe(201);
    expect(queryRes.body.status).toBe('SUCCESS');
    expect(queryRes.body.amount).toBe(5000);

    const acc = await prisma.prepayAccount.findUniqueOrThrow({
      where: { id: setup.prepayAccountId },
    });
    expect(acc.balanceCache).toBe(7000); // 2000 + 5000
  });

  it('预付账户查询展示近30天日均用量与预估可用天数', async () => {
    const setup = await setupTenantWithPrepay({
      roomNumber: '303',
      phone: '13811114444',
      openid: 'wx_openid_tenant_303',
      initialBalance: 30000, // 300 元
    });

    // 模拟近 30 天内发生了扣费（合计 60000 分，即 600 元，平均 20 元/天）
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    await prisma.prepayTransaction.create({
      data: {
        accountId: setup.prepayAccountId,
        type: 'DEDUCTION',
        amount: -60000,
        balanceAfter: 30000,
        description: '水电费自动扣除',
        operatorId: 'SYSTEM',
        createdAt: fifteenDaysAgo,
      },
    });

    const res = await http(app)
      .get('/prepay-accounts/my')
      .set(auth(setup.tenantToken));

    expect(res.status).toBe(200);
    expect(res.body.balanceCache).toBe(30000);
    expect(res.body.dailyAverageUsage).toBe(2000); // 60000 / 30 = 2000 分/天
    expect(res.body.estimatedDaysRemaining).toBe(15); // 30000 / 2000 = 15 天
  });

  it('自动抵扣引擎：依设置中心规则对未缴水电账单自动扣款', async () => {
    const setup = await setupTenantWithPrepay({
      roomNumber: '304',
      phone: '13811115555',
      openid: 'wx_openid_tenant_304',
      initialBalance: 20000, // 200 元预付金
    });

    // 开启自动抵扣设置
    const settingsService = app.get(SettingsService);
    await settingsService.update('prepay.autoDeductEnabled', true, {
      userId: setup.adminId,
      ip: '127.0.0.1',
      userAgent: 'integration-test',
    });

    // 创建一笔待缴水电账单（150 元 = 15000 分）
    const bill = await prisma.bill.create({
      data: {
        contractId: setup.contractId,
        billNumber: 'BILL-UTILITY-304',
        billType: 'UTILITY',
        period: '2026-10',
        amount: 15000,
        paidAmount: 0,
        dueDate: new Date('2026-10-20'),
        status: 'PENDING',
        snapshot: {},
      },
    });

    // 管理员执行触发自动抵扣
    const deductRes = await http(app)
      .post('/prepay-accounts/auto-deduct')
      .set(auth(setup.adminToken));

    expect(deductRes.status).toBe(201);
    expect(deductRes.body.deductedCount).toBeGreaterThanOrEqual(1);

    // 验证账单已结清
    const paidBill = await prisma.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: { paymentRecords: true },
    });
    expect(paidBill.status).toBe('PAID');
    expect(paidBill.paidAmount).toBe(15000);
    expect(paidBill.paymentRecords).toHaveLength(1);

    // 验证预付账户扣款且流水正常
    const acc = await prisma.prepayAccount.findUniqueOrThrow({
      where: { id: setup.prepayAccountId },
      include: { transactions: true },
    });
    expect(acc.balanceCache).toBe(5000); // 20000 - 15000
    const deductTx = acc.transactions.find((t) => t.type === 'DEDUCTION');
    expect(deductTx).toBeDefined();
    expect(deductTx?.amount).toBe(-15000);
    expect(deductTx?.relatedId).toBe(bill.id);
  });
});
