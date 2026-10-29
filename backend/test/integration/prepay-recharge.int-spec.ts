import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../src/modules/bills/payment/payment-provider.js';
import { MockPaymentProvider } from '../../src/modules/bills/payment/mock-payment.provider.js';
import { BillPaymentService } from '../../src/modules/bills/bill-payment.service.js';
import { AuditLogService } from '../../src/modules/audit/audit-log.service.js';
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

describe('预付线上充值、自动扣费与低余额提醒集成测试（T296 / PAY-04）', () => {
  async function setupTenantWithPrepay(params: {
    roomNumber: string;
    tenantName: string;
    phone: string;
    openid: string;
    initialBalance?: number;
    threshold?: number;
    base?: any;
    adminToken?: string;
  }) {
    const base = params.base || (await seedBase());
    const adminToken =
      params.adminToken || (await login(app, base.adminEmail, base.adminPassword));

    // 1. 创建租客用户与外部微信身份
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
        name: params.tenantName,
        phone: params.phone,
      });
    expect(tenantRes.status).toBe(201);
    const tenantId = tenantRes.body.id;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { userId: user.id },
    });

    // 2. 创建房间与合同
    const room = await prisma.room.create({
      data: {
        buildingId: base.buildingId,
        roomNumber: params.roomNumber,
        floor: 3,
        roomType: 'ONE_BED',
        status: 'OCCUPIED',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        contractNumber: `CT-PREPAY-${params.roomNumber}`,
        buildingId: base.buildingId,
        tenantId,
        roomId: room.id,
        rentAmount: 300000,
        depositAmount: 300000,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        lateFeeRule: {},
        status: 'ACTIVE',
      },
    });

    // 3. 创建预付账户
    const prepayAccount = await prisma.prepayAccount.create({
      data: {
        tenantId,
        roomId: room.id,
        balanceCache: params.initialBalance ?? 0,
        lowBalanceThreshold: params.threshold ?? 10000, // 100 元
      },
    });

    const jwtService = app.get(JwtAuthService);
    const tokens = await jwtService.generateTokens({
      sub: user.id,
      role: 'TENANT',
    });

    return {
      adminToken,
      tenantToken: tokens.accessToken,
      user,
      tenantId,
      room,
      contract,
      prepayAccount,
    };
  }

  it('预付充值 JSAPI 下单：生成 PENDING 充值单与调起支付参数', async () => {
    const data = await setupTenantWithPrepay({
      roomNumber: '301',
      tenantName: '张三',
      phone: '13800000301',
      openid: 'wx_openid_tenant_301',
    });

    const res = await http(app)
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .set(auth(data.tenantToken))
      .send({ amount: 20000 }); // 200 元

    expect(res.status).toBe(201);
    expect(res.body.appId).toBeDefined();
    expect(res.body.package).toContain('prepay_id=');
    expect(res.body.outTradeNo).toMatch(/^PREPAY_/);
    expect(res.body.orderId).toBeDefined();

    // 验证数据库创建了 PENDING 订单
    const order = await prisma.prepayRechargeOrder.findUnique({
      where: { outTradeNo: res.body.outTradeNo },
    });
    expect(order).not.toBeNull();
    expect(order?.status).toBe('PENDING');
    expect(order?.amount).toBe(20000);
    expect(order?.accountId).toBe(data.prepayAccount.id);
  });

  it('微信支付回调通知：成功充值入账、生成收据与流水，且同单多次回调幂等', async () => {
    const data = await setupTenantWithPrepay({
      roomNumber: '302',
      tenantName: '李四',
      phone: '13800000302',
      openid: 'wx_openid_tenant_302',
      initialBalance: 5000, // 50 元
    });

    // 1. 发起下单
    const orderRes = await http(app)
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .set(auth(data.tenantToken))
      .send({ amount: 15000 }); // 充值 150 元
    expect(orderRes.status).toBe(201);
    const { outTradeNo } = orderRes.body;

    // 2. 模拟微信服务端发送支付成功异步通知
    const notifyPayload = {
      event_type: 'TRANSACTION.SUCCESS',
      resource: {
        out_trade_no: outTradeNo,
        transaction_id: '420000_PREPAY_001',
        trade_state: 'SUCCESS',
        amount: { total: 15000, payer_total: 15000, currency: 'CNY' },
        payer: { openid: 'wx_openid_tenant_302' },
        attach: JSON.stringify({ type: 'PREPAY_RECHARGE', accountId: data.prepayAccount.id }),
      },
    };

    const notifyRes = await http(app)
      .post('/payments/wechat/notify')
      .send(notifyPayload);
    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body.code).toBe('SUCCESS');

    // 3. 验证充值单已转为 SUCCESS，并分配了收据号
    const order = await prisma.prepayRechargeOrder.findUnique({
      where: { outTradeNo },
    });
    expect(order?.status).toBe('SUCCESS');
    expect(order?.transactionId).toBe('420000_PREPAY_001');
    expect(order?.receiptNumber).toMatch(/^R\d{14}$/);

    // 4. 验证预付账户余额已增加为 5000 + 15000 = 20000
    const updatedAccount = await prisma.prepayAccount.findUnique({
      where: { id: data.prepayAccount.id },
    });
    expect(updatedAccount?.balanceCache).toBe(20000);

    // 5. 验证生成了 ONLINE_RECHARGE 流水
    const transaction = await prisma.prepayTransaction.findFirst({
      where: { accountId: data.prepayAccount.id, type: 'RECHARGE' },
    });
    expect(transaction).not.toBeNull();
    expect(transaction?.amount).toBe(15000);
    expect(transaction?.balanceAfter).toBe(20000);
    expect(transaction?.relatedType).toBe('ONLINE_RECHARGE');

    // 6. 重复发送相同回调通知，验证幂等性（余额不重复叠加）
    const secondNotify = await http(app)
      .post('/payments/wechat/notify')
      .send(notifyPayload);
    expect(secondNotify.status).toBe(200);
    expect(secondNotify.body.code).toBe('SUCCESS');

    const accountAfterDup = await prisma.prepayAccount.findUnique({
      where: { id: data.prepayAccount.id },
    });
    expect(accountAfterDup?.balanceCache).toBe(20000); // 仍为 20000
  });

  it('主动查单补入账：客户端支付完成后主动调查单补全入账', async () => {
    const data = await setupTenantWithPrepay({
      roomNumber: '303',
      tenantName: '王五',
      phone: '13800000303',
      openid: 'wx_openid_tenant_303',
      initialBalance: 0,
    });

    const orderRes = await http(app)
      .post('/prepay-accounts/my/recharge/wechat-jsapi')
      .set(auth(data.tenantToken))
      .send({ amount: 8000 });
    expect(orderRes.status).toBe(201);
    const { outTradeNo } = orderRes.body;

    // 模拟微信网关侧订单状态为 SUCCESS
    mockPaymentProvider.simulateSuccess(outTradeNo, '420000_QUERY_001');

    // 客户端主动调用查单接口
    const queryRes = await http(app)
      .post('/prepay-accounts/my/recharge/wechat-query')
      .set(auth(data.tenantToken))
      .send({ outTradeNo });

    expect(queryRes.status).toBe(201);
    expect(queryRes.body.status).toBe('SUCCESS');
    expect(queryRes.body.receiptNumber).toBeDefined();

    // 验证账户余额已到账
    const account = await prisma.prepayAccount.findUnique({
      where: { id: data.prepayAccount.id },
    });
    expect(account?.balanceCache).toBe(8000);
  });

  it('账单预付余额抵扣：余额充足时全额结清账单，记录 PREPAY 收款并流转账单状态', async () => {
    const data = await setupTenantWithPrepay({
      roomNumber: '304',
      tenantName: '赵六',
      phone: '13800000304',
      openid: 'wx_openid_tenant_304',
      initialBalance: 50000, // 500 元
      threshold: 10000,
    });

    // 创建一张 200 元的水电账单
    const bill = await prisma.bill.create({
      data: {
        contractId: data.contract.id,
        billNumber: 'B-UTILITY-304',
        billType: 'UTILITY',
        period: '2026-10',
        amount: 20000,
        dueDate: new Date('2026-11-05'),
        status: 'PENDING',
        paidAmount: 0,
        snapshot: {},
      },
    });

    // 租客发起预付抵扣
    const payRes = await http(app)
      .post(`/bills/${bill.id}/pay/prepay`)
      .set(auth(data.tenantToken))
      .send({}); // 缺省全额抵扣

    expect(payRes.status).toBe(201);
    expect(payRes.body.payment.amount).toBe(20000);
    expect(payRes.body.payment.paymentMethod).toBe('PREPAY');
    expect(payRes.body.bill.status).toBe('PAID');
    expect(payRes.body.bill.paidAmount).toBe(20000);

    // 验证预付账户扣除了 20000，剩余 30000
    const account = await prisma.prepayAccount.findUnique({
      where: { id: data.prepayAccount.id },
    });
    expect(account?.balanceCache).toBe(30000);

    // 验证预付流水
    const tx = await prisma.prepayTransaction.findFirst({
      where: { accountId: data.prepayAccount.id, relatedId: bill.id },
    });
    expect(tx?.type).toBe('DEDUCTION');
    expect(tx?.amount).toBe(-20000);
    expect(tx?.balanceAfter).toBe(30000);
    expect(tx?.relatedType).toBe('BILL_DEDUCTION');
  });

  it('低余额预警：抵扣后余额低于阈值触发低余额订阅通知并更新 lastNotifiedAt', async () => {
    const data = await setupTenantWithPrepay({
      roomNumber: '305',
      tenantName: '孙七',
      phone: '13800000305',
      openid: 'wx_openid_tenant_305',
      initialBalance: 12000, // 120 元
      threshold: 10000, // 100 元预警线
    });

    // 创建一张 50 元的账单
    const bill = await prisma.bill.create({
      data: {
        contractId: data.contract.id,
        billNumber: 'B-UTILITY-305',
        billType: 'UTILITY',
        period: '2026-10',
        amount: 5000,
        dueDate: new Date('2026-11-05'),
        status: 'PENDING',
        paidAmount: 0,
        snapshot: {},
      },
    });

    // 抵扣后预付余额变为 12000 - 5000 = 7000，跌破阈值 10000
    const payRes = await http(app)
      .post(`/bills/${bill.id}/pay/prepay`)
      .set(auth(data.tenantToken))
      .send({});
    expect(payRes.status).toBe(201);

    // 检查预付账户已被记录 lastNotifiedAt
    const account = await prisma.prepayAccount.findUnique({
      where: { id: data.prepayAccount.id },
    });
    expect(account?.balanceCache).toBe(7000);
    expect(account?.lastNotifiedAt).not.toBeNull();

    // 检查产生了低余额通知
    const notification = await prisma.notification.findFirst({
      where: { userId: data.user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    expect(notification?.title).toContain('预付');
  });
  it('收款登记失败必须回滚预付扣款', async () => {
    const data = await setupTenantWithPrepay({ roomNumber: '901', tenantName: '测试', phone: '13800000901', openid: 'test901', initialBalance: 100000 });
    const bill = await prisma.bill.create({ data: { contractId: data.contract.id, billNumber: 'TEST-901', billType: 'RENT', period: '2026-02', amount: 80000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const spy = vi.spyOn(app.get(AuditLogService), 'recordEvent').mockRejectedValueOnce(new Error('injected failure'));
    const res = await http(app).post(`/bills/${bill.id}/pay/prepay`).set(auth(data.tenantToken)).send({ amount: 60000, idempotencyKey: 'test-failure-901' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: data.prepayAccount.id } })).balanceCache).toBe(100000);
    expect(await prisma.prepayTransaction.count({ where: { accountId: data.prepayAccount.id, relatedId: bill.id } })).toBe(0);
    expect(await prisma.paymentRecord.count({ where: { billId: bill.id } })).toBe(0);
    spy.mockRestore();
  });
  it('相同幂等键重复请求只扣一次', async () => {
    const data = await setupTenantWithPrepay({ roomNumber: '902', tenantName: '测试', phone: '13800000902', openid: 'test902', initialBalance: 100000 });
    const bill = await prisma.bill.create({ data: { contractId: data.contract.id, billNumber: 'TEST-902', billType: 'RENT', period: '2026-02', amount: 80000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const send = () => http(app).post(`/bills/${bill.id}/pay/prepay`).set(auth(data.tenantToken)).send({ amount: 30000, idempotencyKey: 'test-retry-902' });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: data.prepayAccount.id } })).balanceCache).toBe(70000);
    expect(await prisma.prepayTransaction.count({ where: { accountId: data.prepayAccount.id, relatedId: bill.id } })).toBe(1);
  });

  it('并发同键重试只扣一次且不同请求正常结算', async () => {
    const data = await setupTenantWithPrepay({ roomNumber: '903', tenantName: '测试', phone: '13800000903', openid: 'test903', initialBalance: 100000 });
    const bill = await prisma.bill.create({ data: { contractId: data.contract.id, billNumber: 'TEST-903', billType: 'RENT', period: '2026-02', amount: 80000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const send = (key: string, amount: number, token = data.tenantToken) => http(app).post(`/bills/${bill.id}/pay/prepay`).set(auth(token)).send({ amount, idempotencyKey: key });
    const other = await setupTenantWithPrepay({ roomNumber: '904', tenantName: '测试二', phone: '13800000904', openid: 'test904', base: { buildingId: data.room.buildingId }, adminToken: data.adminToken });
    expect((await send('unauthorized', 10000, other.tenantToken)).status).toBe(403);
    const results = await Promise.all([send('concurrent-key', 30000), send('concurrent-key', 30000)]);
    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: data.prepayAccount.id } })).balanceCache).toBe(70000);
    expect(await prisma.prepayTransaction.count({ where: { accountId: data.prepayAccount.id, relatedId: bill.id } })).toBe(1);
    expect((await send('different-key', 20000)).status).toBe(201);
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: data.prepayAccount.id } })).balanceCache).toBe(50000);
    expect((await send('concurrent-key', 10000)).status).toBe(409);
  });

  it('截額後同鍵重試仍按原始請求比對', async () => {
    const data = await setupTenantWithPrepay({ roomNumber: '905', tenantName: '测试', phone: '13800000905', openid: 'test905', initialBalance: 40000 });
    const bill = await prisma.bill.create({ data: { contractId: data.contract.id, billNumber: 'TEST-905', billType: 'RENT', period: '2026-02', amount: 80000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const send = (amount: number) => http(app).post(`/bills/${bill.id}/pay/prepay`).set(auth(data.tenantToken)).send({ amount, idempotencyKey: 'clipped-905' });
    const results = await Promise.all([send(60000), send(60000)]);
    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: data.prepayAccount.id } })).balanceCache).toBe(0);
    expect(await prisma.prepayTransaction.count({ where: { accountId: data.prepayAccount.id, relatedId: bill.id } })).toBe(1);
    expect((await send(40000)).status).toBe(409);
    expect((await send(60000)).status).toBe(201);
  });

  it('截到未付金额后同键重试，零余额不产生扣款', async () => {
    const data = await setupTenantWithPrepay({ roomNumber: '906', tenantName: '测试', phone: '13800000906', openid: 'test906', initialBalance: 100000 });
    const bill = await prisma.bill.create({ data: { contractId: data.contract.id, billNumber: 'TEST-906', billType: 'RENT', period: '2026-02', amount: 30000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const send = (token: string, key: string, amount: number) => http(app).post(`/bills/${bill.id}/pay/prepay`).set(auth(token)).send({ amount, idempotencyKey: key });
    expect((await send(data.tenantToken, 'bill-cap-906', 60000)).status).toBe(201);
    expect((await send(data.tenantToken, 'bill-cap-906', 60000)).status).toBe(201);
    expect((await send(data.adminToken, 'bill-cap-906', 60000)).status).toBe(409);
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: data.prepayAccount.id } })).balanceCache).toBe(70000);
    const empty = await setupTenantWithPrepay({ roomNumber: '907', tenantName: '测试二', phone: '13800000907', openid: 'test907', base: { buildingId: data.room.buildingId }, adminToken: data.adminToken, initialBalance: 0 });
    const bill2 = await prisma.bill.create({ data: { contractId: empty.contract.id, billNumber: 'TEST-907', billType: 'RENT', period: '2026-02', amount: 30000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const response = await http(app).post(`/bills/${bill2.id}/pay/prepay`).set(auth(empty.tenantToken)).send({ amount: 10000, idempotencyKey: 'empty-907' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.prepayTransaction.count({ where: { accountId: empty.prepayAccount.id, relatedId: bill2.id } })).toBe(0);
  });

  it('跨账单并发同键只成功一次，另一笔余额与流水回滚', async () => {
    const a = await setupTenantWithPrepay({ roomNumber: '908', tenantName: '测试甲', phone: '13800000908', openid: 'test908', initialBalance: 100000 });
    const b = await setupTenantWithPrepay({ roomNumber: '909', tenantName: '测试乙', phone: '13800000909', openid: 'test909', initialBalance: 100000, base: { buildingId: a.room.buildingId }, adminToken: a.adminToken });
    const makeBill = (data: typeof a, number: string) => prisma.bill.create({ data: { contractId: data.contract.id, billNumber: number, billType: 'RENT', period: '2026-02', amount: 80000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    const [billA, billB] = await Promise.all([makeBill(a, 'TEST-908'), makeBill(b, 'TEST-909')]);
    const post = (billId: string, token: string) => http(app).post(`/bills/${billId}/pay/prepay`).set(auth(token)).send({ amount: 30000, idempotencyKey: 'cross-bill-key' });
    const providerSpy = vi.spyOn(mockPaymentProvider, 'createOrder');
    const responses = await Promise.all([post(billA.id, a.tenantToken), post(billB.id, b.tenantToken)]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(providerSpy).not.toHaveBeenCalled();
    const balances = await Promise.all([a, b].map(d => prisma.prepayAccount.findUniqueOrThrow({ where: { id: d.prepayAccount.id } })));
    expect(balances.map(x => x.balanceCache).sort((left, right) => left - right)).toEqual([70000, 100000]);
    expect(await prisma.prepayTransaction.count({ where: { accountId: { in: [a.prepayAccount.id, b.prepayAccount.id] }, relatedType: 'BILL_DEDUCTION' } })).toBe(1);
    expect(await prisma.paymentRecord.count({ where: { idempotencyKey: 'cross-bill-key' } })).toBe(1);
    providerSpy.mockRestore();
  });
  it('API 和服务均拒绝零与负数金额，不改变余额', async () => {
    const data = await setupTenantWithPrepay({ roomNumber: '910', tenantName: '测试', phone: '13800000910', openid: 'test910', initialBalance: 100000 });
    const bill = await prisma.bill.create({ data: { contractId: data.contract.id, billNumber: 'TEST-910', billType: 'RENT', period: '2026-02', amount: 80000, snapshot: {}, dueDate: new Date('2026-02-10') } });
    for (const amount of [0, -1]) {
      expect((await http(app).post(`/bills/${bill.id}/pay/prepay`).set(auth(data.tenantToken)).send({ amount })).status).toBe(400);
      await expect(app.get(BillPaymentService).payWithPrepay(bill.id, { amount }, { userId: data.user.id, role: 'TENANT' })).rejects.toThrow();
    }
    expect((await prisma.prepayAccount.findUniqueOrThrow({ where: { id: data.prepayAccount.id } })).balanceCache).toBe(100000);
    expect(await prisma.prepayTransaction.count({ where: { accountId: data.prepayAccount.id, relatedId: bill.id } })).toBe(0);
  });

});
