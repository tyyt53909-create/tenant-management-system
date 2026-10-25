import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { auth, createApp, http, prisma, resetDatabase, seedBase, setupTenancy } from './harness.js';

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

describe('收据系统全链路集成测试（连续编号、验真、作废、PDF 导出）(T295 / PAY-03)', () => {
  it('生成连续编号收据、公开防伪验真、PDF 导出、作废状态呈现与租客防越权', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    // 1. 创建账单
    const billRes = await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'RENT',
        period: '2026-10',
        amount: 250000,
        dueDate: '2026-10-10',
      });
    expect(billRes.status).toBe(201);
    const billId = billRes.body.id;
    const payableAmount = billRes.body.amount;

    // 2. 记账收款，触发连续收据号生成
    const payRes = await http(app)
      .post(`/bills/${billId}/payments`)
      .set(auth(tenancy.adminToken))
      .send({
        amount: payableAmount,
        paymentMethod: 'WECHAT',
        transactionNumber: 'WX_TRX_20261025_0001',
        notes: '10月份租金实收',
      });
    expect(payRes.status).toBe(201);
    const payment = payRes.body.payment;
    expect(payment.receiptNumber).toMatch(/^R\d{8}\d{6}$/);
    const receiptNumber = payment.receiptNumber;

    // 3. 管理员端获取单笔收据凭证
    const adminReceiptRes = await http(app)
      .get(`/bills/${billId}/payments/${payment.id}/receipt`)
      .set(auth(tenancy.adminToken));
    expect(adminReceiptRes.status).toBe(200);
    expect(adminReceiptRes.body.receiptNumber).toBe(receiptNumber);
    expect(adminReceiptRes.body.amount).toBe(payableAmount);
    expect(adminReceiptRes.body.verifyCode).toHaveLength(16);
    expect(adminReceiptRes.body.isVoided).toBe(false);
    expect(adminReceiptRes.body.status).toBe('CONFIRMED');
    const verifyCode = adminReceiptRes.body.verifyCode;

    // 4. 租客端查询收据凭单（有权限）
    const tenantReceiptRes = await http(app)
      .get(`/bills/${billId}/payments/${payment.id}/receipt`)
      .set(auth(tenancy.tenantToken));
    expect(tenantReceiptRes.status).toBe(200);
    expect(tenantReceiptRes.body.receiptNumber).toBe(receiptNumber);

    // 5. 租客防越权：未授权租客无法查看他人收据
    const otherTenancy = await setupTenancy(app, base);
    const forbiddenRes = await http(app)
      .get(`/bills/${billId}/payments/${payment.id}/receipt`)
      .set(auth(otherTenancy.tenantToken));
    expect(forbiddenRes.status).toBe(404);

    // 6. 管理端及租客端 PDF 导出测试
    const billPdfRes = await http(app)
      .get(`/bills/${billId}/receipt/pdf`)
      .set(auth(tenancy.adminToken))
      .responseType('blob');
    expect(billPdfRes.status).toBe(200);
    expect(billPdfRes.headers['content-type']).toContain('application/pdf');
    expect(billPdfRes.body.slice(0, 8).toString()).toContain('%PDF-1.4');

    const paymentPdfRes = await http(app)
      .get(`/bills/${billId}/payments/${payment.id}/receipt/pdf`)
      .set(auth(tenancy.tenantToken))
      .responseType('blob');
    expect(paymentPdfRes.status).toBe(200);
    expect(paymentPdfRes.headers['content-type']).toContain('application/pdf');
    expect(paymentPdfRes.body.slice(0, 8).toString()).toContain('%PDF-1.4');

    // 7. 公开防伪验真端点测试（@Public，无需 Token，隐私脱敏）
    // 7.1 正确收据号与正确防伪码验真
    const publicVerifyRes = await http(app)
      .get(`/public/receipts/${receiptNumber}/verify?code=${verifyCode}`);
    expect(publicVerifyRes.status).toBe(200);
    expect(publicVerifyRes.body.valid).toBe(true);
    expect(publicVerifyRes.body.receiptNumber).toBe(receiptNumber);
    expect(publicVerifyRes.body.amount).toBe(payableAmount);
    expect(publicVerifyRes.body.isVoided).toBe(false);
    expect(publicVerifyRes.body.message).toBe('收据真实有效');
    // 验证姓名与手机号脱敏
    expect(publicVerifyRes.body.payerName).toMatch(/^.\*/);
    expect(publicVerifyRes.body.payerPhone).toMatch(/^\d{3}\*{4}\d{4}$/);

    // 7.2 按 Query 验真
    const publicQueryVerifyRes = await http(app)
      .get(`/public/receipts/verify?receiptNumber=${receiptNumber}&code=${verifyCode}`);
    expect(publicQueryVerifyRes.status).toBe(200);
    expect(publicQueryVerifyRes.body.valid).toBe(true);

    // 7.3 防伪码错误防伪拦截
    const fakeCodeRes = await http(app)
      .get(`/public/receipts/${receiptNumber}/verify?code=INVALIDCODE88888`);
    expect(fakeCodeRes.status).toBe(200);
    expect(fakeCodeRes.body.valid).toBe(false);
    expect(fakeCodeRes.body.message).toContain('防伪校验码不匹配');

    // 7.4 查验不存在的收据号
    const notFoundReceiptRes = await http(app)
      .get('/public/receipts/R99999999999999/verify');
    expect(notFoundReceiptRes.status).toBe(200);
    expect(notFoundReceiptRes.body.valid).toBe(false);
    expect(notFoundReceiptRes.body.message).toContain('不存在');

    // 7.5 公开下载收据 PDF
    const publicPdfRes = await http(app)
      .get(`/public/receipts/${receiptNumber}/pdf`)
      .responseType('blob');
    expect(publicPdfRes.status).toBe(200);
    expect(publicPdfRes.headers['content-type']).toContain('application/pdf');
    expect(publicPdfRes.body.slice(0, 8).toString()).toContain('%PDF-1.4');

    // 8. 作废收款测试（作废状态与原因闭环联动）
    const voidRes = await http(app)
      .post(`/bills/${billId}/payments/${payment.id}/void`)
      .set(auth(tenancy.adminToken))
      .send({ reason: '租客重复转账，作废冲正' });
    expect(voidRes.status).toBe(201);

    // 8.1 再次查询单笔收据凭证 -> 状态变更为 VOIDED
    const voidedReceiptRes = await http(app)
      .get(`/bills/${billId}/payments/${payment.id}/receipt`)
      .set(auth(tenancy.adminToken));
    expect(voidedReceiptRes.status).toBe(200);
    expect(voidedReceiptRes.body.status).toBe('VOIDED');
    expect(voidedReceiptRes.body.isVoided).toBe(true);
    expect(voidedReceiptRes.body.voidReason).toBe('租客重复转账，作废冲正');
    expect(voidedReceiptRes.body.voidedAt).toBeDefined();

    // 8.2 公开验真查验已作废收据 -> 提示已作废
    const voidedVerifyRes = await http(app)
      .get(`/public/receipts/${receiptNumber}/verify`);
    expect(voidedVerifyRes.status).toBe(200);
    expect(voidedVerifyRes.body.valid).toBe(true);
    expect(voidedVerifyRes.body.isVoided).toBe(true);
    expect(voidedVerifyRes.body.status).toBe('VOIDED');
    expect(voidedVerifyRes.body.voidReason).toBe('租客重复转账，作废冲正');
    expect(voidedVerifyRes.body.message).toContain('已于');
    expect(voidedVerifyRes.body.message).toContain('作废');

    // 8.3 导出已作废收据的 PDF，确认包含 VOIDED 标记
    const voidedPdfRes = await http(app)
      .get(`/public/receipts/${receiptNumber}/pdf`)
      .responseType('blob');
    expect(voidedPdfRes.status).toBe(200);
    const pdfText = voidedPdfRes.body.toString('utf8');
    expect(pdfText).toContain('VOIDED');
    expect(pdfText).toContain('租客重复转账，作废冲正');
  });
});
