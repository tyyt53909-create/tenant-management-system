import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { BillPaymentService } from '../../src/modules/bills/bill-payment.service.js';
import { PaymentMethod } from '../../src/modules/bills/dto/create-payment.dto.js';
import { DepositsService } from '../../src/modules/deposits/deposits.service.js';
import { EmailOtpService } from '../../src/modules/auth/email-otp.service.js';
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

describe('真实财务与业务审计日志（T323 - R09）', () => {
  it('收款在业务事务内写入真实前后值与操作者', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const due = new Date();
    due.setDate(due.getDate() + 7);
    const bill = await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'RENT',
        period: '2099-09',
        amount: 300000,
        dueDate: due.toISOString().slice(0, 10),
        snapshot: {},
      });
    expect(bill.status).toBe(201);
    const billId = bill.body.id as string;

    const paymentService = app.get(BillPaymentService);
    const paymentResult = await paymentService.addPayment(
      billId,
      { amount: 300000, paymentMethod: PaymentMethod.CASH, notes: '租客柜台现金缴租' },
      base.adminId,
    );
    expect(paymentResult.payment.status).toBe('CONFIRMED');

    const paymentAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'Bill',
        entityId: billId,
        action: 'BILL_PAYMENT',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(paymentAudit).toBeDefined();
    expect(paymentAudit?.userId).toBe(base.adminId);
    expect(paymentAudit?.changes).toMatchObject({
      before: { paidAmount: 0, status: 'PENDING' },
      after: { paidAmount: 300000, status: 'PAID' },
      reason: '租客柜台现金缴租',
    });
  });

  it('作废冲正在业务事务内记录原收款与冲正前后值', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const due = new Date();
    due.setDate(due.getDate() + 7);
    const bill = await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'RENT',
        period: '2099-08',
        amount: 200000,
        dueDate: due.toISOString().slice(0, 10),
        snapshot: {},
      });
    const billId = bill.body.id as string;

    const paymentService = app.get(BillPaymentService);
    const { payment } = await paymentService.addPayment(
      billId,
      { amount: 200000, paymentMethod: PaymentMethod.ALIPAY },
      base.adminId,
    );

    await paymentService.voidPayment(billId, payment.id, base.adminId, '操作员录错金额，冲正处理');

    const reversalAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'PaymentRecord',
        entityId: payment.id,
        action: 'PAYMENT_REVERSAL',
      },
    });
    expect(reversalAudit).toBeDefined();
    expect(reversalAudit?.userId).toBe(base.adminId);
    expect(reversalAudit?.changes).toMatchObject({
      before: { paymentStatus: 'CONFIRMED', billPaidAmount: 200000, billStatus: 'PAID' },
      after: { paymentStatus: 'VOIDED', billPaidAmount: 0, billStatus: 'PENDING' },
      reason: '操作员录错金额，冲正处理',
    });
  });

  it('押金退还与扣除在事务内记录余额变动审计', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const due = new Date();
    due.setDate(due.getDate() + 7);
    const depBill = await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'DEPOSIT',
        period: '2099-DEP-AUDIT',
        amount: 200000,
        dueDate: due.toISOString().slice(0, 10),
        snapshot: {},
      });
    await http(app)
      .post(`/bills/${depBill.body.id}/payments`)
      .set(auth(tenancy.adminToken))
      .send({ amount: 200000, paymentMethod: 'CASH' });

    const depositsService = app.get(DepositsService);
    await depositsService.refund(tenancy.contractId, 50000, '部分退还', base.adminId);

    const refundAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'DEPOSIT_REFUND',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(refundAudit).toBeDefined();
    expect(refundAudit?.userId).toBe(base.adminId);
    expect(refundAudit?.changes).toMatchObject({
      before: { balance: 200000 },
      after: { balance: 150000 },
      reason: '部分退还',
    });
  });

  it('租客身份认领在注册事务内记录绑定审计事件', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);

    const tenantEmail = `claim-audit-${Date.now()}@example.com`;
    const tenantRes = await http(app)
      .post('/tenants')
      .set(auth(adminToken))
      .send({ name: '认领审计租客', phone: '13811223344', email: tenantEmail });
    expect(tenantRes.status).toBe(201);
    const tenantId = tenantRes.body.id as string;

    const inviteRes = await http(app)
      .post('/auth/invite-codes')
      .set(auth(adminToken))
      .send({ role: 'TENANT', tenantId, expiryDays: 1 });
    expect(inviteRes.status).toBe(201);
    const inviteCode = inviteRes.body.inviteCode as string;

    await app.get(EmailOtpService).seedCodeForTests(tenantEmail, '998877');

    const regRes = await http(app).post('/auth/register').send({
      email: tenantEmail,
      password: 'Tenant@123',
      inviteCode,
      emailCode: '998877',
    });
    expect(regRes.status).toBe(201);
    const newUserId = regRes.body.user.id as string;

    const claimAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'TENANT_CLAIM',
        entityType: 'Tenant',
        entityId: tenantId,
      },
    });
    expect(claimAudit).toBeDefined();
    expect(claimAudit?.userId).toBe(newUserId);
    expect(claimAudit?.changes).toMatchObject({
      before: { userId: null },
      after: { userId: newUserId, role: 'TENANT' },
    });
  });
});
