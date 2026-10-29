import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../src/modules/bills/payment/payment-provider.js';
import { MockPaymentProvider } from '../../src/modules/bills/payment/mock-payment.provider.js';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';
import { DiscrepancyResolveAction } from '../../src/modules/bills/dto/reconciliation.dto.js';
import { BusinessClock } from '../../src/common/business-clock/business-clock.service.js';

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

describe('微信退款、对账与差异处理整合测试（T294 / PAY-02）', () => {
  async function setupTenantWithContract(params: {
    roomNumber: string;
    tenantName: string;
    phone: string;
    openid: string;
    billType?: string;
  }) {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

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

    const bill = await prisma.bill.create({
      data: {
        contractId: contract.id,
        billNumber: `BILL-${params.roomNumber}-01`,
        billType: (params.billType as any) || 'RENT',
        period: '2026-10',
        amount: 300000,
        paidAmount: 0,
        dueDate: new Date('2026-10-15'),
        status: 'PENDING',
        snapshot: {},
      },
    });

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

  it('管理端申请原路退款与回调通知冲正：产生 REVERSAL、账单金额扣减且重复回调保持幂等', async () => {
    const data = await setupTenantWithContract({
      roomNumber: '601',
      tenantName: '退款测试租客',
      phone: '13811110001',
      openid: 'wx_openid_refund_1',
    });

    // 1. 先通过微信支付完成一笔 300000 分的收款
    const payRes = await http(app)
      .post(`/bills/${data.billId}/pay/wechat-jsapi`)
      .set(auth(data.tenantToken))
      .send();
    expect(payRes.status).toBe(201);
    const outTradeNo = payRes.body.outTradeNo;

    await http(app)
      .post('/payments/wechat/notify')
      .send({
        out_trade_no: outTradeNo,
        transaction_id: '420000_REF_TEST_1',
        amount: { total: 300000 },
        payer: { openid: 'wx_openid_refund_1' },
        attach: JSON.stringify({ billId: data.billId, userId: data.userId }),
      });

    const billPaid = await prisma.bill.findUnique({
      where: { id: data.billId },
      include: { paymentRecords: true },
    });
    expect(billPaid?.status).toBe('PAID');
    expect(billPaid?.paidAmount).toBe(300000);
    const paymentId = billPaid!.paymentRecords[0].id;

    // 2. 管理端申请全额退款
    const refundRes = await http(app)
      .post(`/bills/${data.billId}/payments/${paymentId}/refund`)
      .set(auth(data.adminToken))
      .send({ requestKey: 'integration-rent-refund', reason: '租金折算退还' });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.refund).toBeDefined();
    expect(refundRes.body.refund.amount).toBe(300000);
    const outRefundNo = refundRes.body.refund.outRefundNo;

    // 3. 模拟微信退款异步通知回调到达
    const notifyRes1 = await http(app)
      .post('/payments/wechat/refund-notify')
      .send({
        out_refund_no: outRefundNo,
        refund_id: refundRes.body.refund.refundId,
        refund_status: 'SUCCESS',
        amount: { total: 300000, refund: 300000 },
        user_received_account: '招商银行(0123)',
      });

    expect(notifyRes1.status).toBe(200);
    expect(notifyRes1.body.code).toBe('SUCCESS');

    // 4. 验证财务数据：原收款变为 VOIDED，产生 REVERSAL 记录，账单 paidAmount 归零
    const billAfterRefund = await prisma.bill.findUnique({
      where: { id: data.billId },
      include: { paymentRecords: true, refundRecords: true },
    });

    expect(billAfterRefund?.paidAmount).toBe(0);
    expect(billAfterRefund?.status).toBe('PENDING');

    const originalPayment = billAfterRefund?.paymentRecords.find((p) => p.id === paymentId);
    expect(originalPayment?.status).toBe('VOIDED');

    const reversalPayment = billAfterRefund?.paymentRecords.find((p) => p.status === 'REVERSAL');
    expect(reversalPayment).toBeDefined();
    expect(reversalPayment?.amount).toBe(-300000);
    expect(reversalPayment?.reversalOfId).toBe(paymentId);

    const refundRec = billAfterRefund?.refundRecords[0];
    expect(refundRec?.status).toBe('SUCCESS');
    expect(refundRec?.refundId).toBe(refundRes.body.refund.refundId);
    const aging = await http(app).get('/bills/current-aging?billType=RENT').set(auth(data.adminToken));
    expect(aging.status).toBe(200);
    const rent = aging.body.groups[0];
    expect(rent.principal).toBe(300000);
    expect(rent.unknownPrincipalCount).toBe(0);
    expect(Object.values(rent.buckets).some((cell: any) => cell.billIds.includes(data.billId))).toBe(true);


    // 5. 重复推送相同退款通知，验证幂等性
    const notifyRes2 = await http(app)
      .post('/payments/wechat/refund-notify')
      .send({
        out_refund_no: outRefundNo,
        refund_id: refundRes.body.refund.refundId,
        refund_status: 'SUCCESS',
        amount: { total: 300000, refund: 300000 },
      });

    expect(notifyRes2.status).toBe(200);
    expect(notifyRes2.body.code).toBe('SUCCESS');

    const billRepeat = await prisma.bill.findUnique({
      where: { id: data.billId },
      include: { paymentRecords: true },
    });
    // 依然只有原收款和一笔冲正记录，总数 2
    expect(billRepeat?.paymentRecords).toHaveLength(2);
  });

  it('押金账单微信退款：退款成功后同步核减押金台账余额 (FIN-03)', async () => {
    const data = await setupTenantWithContract({
      roomNumber: '602',
      tenantName: '押金退款租客',
      phone: '13811110002',
      openid: 'wx_openid_refund_2',
      billType: 'DEPOSIT',
    });

    await prisma.depositLedger.create({
      data: {
        contractId: data.contractId,
        tenantId: data.tenantId,
        roomId: data.room.id,
        amount: 300000,
        balance: 0,
        status: 'HELD',
      },
    });

    // 1. 线上缴纳押金
    const payRes = await http(app)
      .post(`/bills/${data.billId}/pay/wechat-jsapi`)
      .set(auth(data.tenantToken))
      .send();
    const outTradeNo = payRes.body.outTradeNo;

    await http(app)
      .post('/payments/wechat/notify')
      .send({
        out_trade_no: outTradeNo,
        transaction_id: '420000_DEP_1',
        amount: { total: 300000 },
        payer: { openid: 'wx_openid_refund_2' },
        attach: JSON.stringify({ billId: data.billId }),
      });

    const ledgerAfterPay = await prisma.depositLedger.findUnique({
      where: { contractId: data.contractId },
    });
    expect(ledgerAfterPay?.balance).toBe(300000);

    const bill = await prisma.bill.findUnique({
      where: { id: data.billId },
      include: { paymentRecords: true },
    });
    const paymentId = bill!.paymentRecords[0].id;

    // 2. 申请并完成押金退款
    const refundRes = await http(app)
      .post(`/bills/${data.billId}/payments/${paymentId}/refund`)
      .set(auth(data.adminToken))
      .send({ requestKey: 'integration-deposit-refund', reason: '退租押金原路退还' });
    const outRefundNo = refundRes.body.refund.outRefundNo;

    await http(app)
      .post('/payments/wechat/refund-notify')
      .send({
        out_refund_no: outRefundNo,
        refund_id: refundRes.body.refund.refundId,
        refund_status: 'SUCCESS',
        amount: { total: 300000, refund: 300000 },
      });

    // 3. 验证押金台账余额已核减至 0，且产生 REVERSAL 事务
    const ledgerAfterRefund = await prisma.depositLedger.findUnique({
      where: { contractId: data.contractId },
      include: { transactions: { orderBy: { createdAt: 'desc' } } },
    });
    expect(ledgerAfterRefund?.balance).toBe(0);
    expect(ledgerAfterRefund?.transactions[0].type).toBe('REVERSAL');
    expect(ledgerAfterRefund?.transactions[0].amount).toBe(-300000);
  });

  it('日终对账单比对与掉单自动补账：准确发现差异并触发 AUTO_SYNC 成功入账', async () => {
    const data = await setupTenantWithContract({
      roomNumber: '603',
      tenantName: '对账测试租客',
      phone: '13811110003',
      openid: 'wx_openid_rec_3',
    });

    const clock = app.get(BusinessClock);
    const billDateStr = clock.formatDate();

    // 1. 设置对账单数据：
    //    第 1 笔：系统已正常入账的一致单据
    //    第 2 笔：微信有流水，但系统掉单（SYSTEM_MISSING）
    const dropOutTradeNo = `WP_DROPPED_${Date.now()}`;
    const dropTxId = '420000_DROPPED_999';

    // 存入 mockProvider 订单缓存便于自动补单关联 billId
    // 创建第二期未支付账单 bill2 用于模拟掉单补缴
    const bill2 = await prisma.bill.create({
      data: {
        contractId: data.contractId,
        billNumber: `BILL-603-02`,
        billType: 'RENT',
        period: '2026-11',
        amount: 300000,
        paidAmount: 0,
        dueDate: new Date('2026-11-15'),
        status: 'PENDING',
        snapshot: {},
      },
    });

    mockPaymentProvider.simulateSuccess(dropOutTradeNo, dropTxId);
    const order = mockPaymentProvider.getOrder(dropOutTradeNo)!;
    order.billId = bill2.id;
    order.amount = 300000;

    // 先在系统记录一笔正常交易
    const payRes = await http(app)
      .post(`/bills/${data.billId}/pay/wechat-jsapi`)
      .set(auth(data.tenantToken))
      .send();
    const normalOutTradeNo = payRes.body.outTradeNo;

    await http(app)
      .post('/payments/wechat/notify')
      .send({
        out_trade_no: normalOutTradeNo,
        transaction_id: '420000_NORMAL_1',
        amount: { total: 300000 },
        payer: { openid: 'wx_openid_rec_3' },
        attach: JSON.stringify({ billId: data.billId }),
      });

    mockPaymentProvider.setMockTradeBillItems([
      {
        tradeTime: `${billDateStr} 10:00:00`,
        appId: 'wx_mock_appid',
        mchId: '1600000001',
        transactionId: '420000_NORMAL_1',
        outTradeNo: normalOutTradeNo,
        tradeType: 'JSAPI',
        tradeState: 'SUCCESS',
        totalAmount: 300000,
      },
      {
        tradeTime: `${billDateStr} 15:30:00`,
        appId: 'wx_mock_appid',
        mchId: '1600000001',
        transactionId: dropTxId,
        outTradeNo: dropOutTradeNo,
        tradeType: 'JSAPI',
        tradeState: 'SUCCESS',
        totalAmount: 300000,
      },
    ]);

    // 2. 触发日终对账比对
    const recRunRes = await http(app)
      .post('/payments/reconciliation/run')
      .set(auth(data.adminToken))
      .send({ billDate: billDateStr });

    expect(recRunRes.status).toBe(201);
    expect(recRunRes.body.batchNumber).toMatch(/^REC_/);
    expect(recRunRes.body.matchedCount).toBe(1);
    expect(recRunRes.body.discrepancyCount).toBe(1);

    const batchId = recRunRes.body.id;

    // 3. 查询批次详情
    const detailRes = await http(app)
      .get(`/payments/reconciliation/batches/${batchId}`)
      .set(auth(data.adminToken));

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.items).toHaveLength(2);

    const droppedItem = detailRes.body.items.find(
      (i: any) => i.type === 'SYSTEM_MISSING',
    );
    expect(droppedItem).toBeDefined();
    expect(droppedItem.outTradeNo).toBe(dropOutTradeNo);
    expect(droppedItem.resolved).toBe(false);

    // 4. 针对掉单差异触发 AUTO_SYNC 自动补单入账
    const resolveRes = await http(app)
      .post(`/payments/reconciliation/items/${droppedItem.id}/resolve`)
      .set(auth(data.adminToken))
      .send({
        action: DiscrepancyResolveAction.AUTO_SYNC,
        notes: '日终对账自动补单入账',
      });

    expect(resolveRes.status).toBe(201);
    expect(resolveRes.body.resolved).toBe(true);
    expect(resolveRes.body.resolveNotes).toContain('自动补');

    // 5. 验证该掉单已成功入账至账单 PaymentRecord
    const billAfterSync = await prisma.bill.findUnique({
      where: { id: bill2.id },
      include: { paymentRecords: true },
    });

    const syncedPayment = billAfterSync?.paymentRecords.find(
      (p) => p.transactionNumber === dropTxId,
    );
    expect(syncedPayment).toBeDefined();
    expect(syncedPayment?.amount).toBe(300000);
    expect(syncedPayment?.paymentMethod).toBe('WECHAT');
  });
});
