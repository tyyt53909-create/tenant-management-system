import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, setupTenancy, http, auth } from './harness.js';

/**
 * QLT-01 / T255：真实 PostgreSQL 的 J1–J7 关键旅程。
 *
 * 当前可执行：J1（招租→绑定→合同唯一）、J5（报修闭环与非法流转）。
 * 依赖尚未完成的业务任务，先用 `describe.skip` 留桩，避免把「未实现」写成「通过」：
 * - J2 计费引擎（FIN-02 / T266）
 * - J3 逾期与催缴（FIN-04 / T272）
 * - J4 收款并发/作废/溢缴（FIN-05 / T264）
 * - J6 续签（FIN-01 / T263）
 * - J7 退租结算（FIN-07 / T273）
 */

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

describe('J1 招租到入住（真实 DB）', () => {
  it('预建租客 + 邀请码 → 绑定档案 → 合同唯一 ACTIVE', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    // 注册后 /auth/me 必须绑定到预建租客，而不是新建档案（DEC-03）
    const me = await http(app).get('/auth/me').set(auth(tenancy.tenantToken));
    expect(me.status).toBe(200);
    expect(me.body.tenant?.id).toBe(tenancy.tenantId);
    expect(me.body.role).toBe('TENANT');

    // 合同已生效，房间随动为 OCCUPIED
    const contract = await http(app)
      .get(`/contracts/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(contract.status).toBe(200);
    expect(contract.body.status).toBe('ACTIVE');

    const room = await http(app).get(`/rooms/${tenancy.roomId}`).set(auth(tenancy.adminToken));
    expect(room.status).toBe(200);
    expect(room.body.status).toBe('OCCUPIED');

    // 同房间第二份未结束合同必须被拒（唯一 ACTIVE / 未结束合同）
    const start = new Date();
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    const duplicate = await http(app)
      .post('/contracts')
      .set(auth(tenancy.adminToken))
      .send({
        buildingId: base.buildingId,
        roomId: tenancy.roomId,
        tenantId: tenancy.tenantId,
        rentAmount: 300000,
        depositAmount: 0,
        paymentCycle: 'MONTHLY',
        paymentDay: 1,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      });
    expect([409, 422]).toContain(duplicate.status);
  });
});

describe('J5 报修闭环（真实 DB）', () => {
  it('租客提交 → 派单 → 完工；非法回退被拒', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const created = await http(app)
      .post('/maintenance')
      .set(auth(tenancy.tenantToken))
      .send({
        title: '厨房水管漏水',
        description: '水槽下方持续滴水',
        category: 'PLUMBING',
        priority: 'NORMAL',
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe('SUBMITTED');
    // 租客不能伪造房间/租客归属
    expect(created.body.roomId).toBe(tenancy.roomId);
    expect(created.body.tenantId).toBe(tenancy.tenantId);

    for (const payload of [
      { status: 'ACKNOWLEDGED' },
      { status: 'ASSIGNED', assignedTo: base.cleanerId },
      { status: 'IN_PROGRESS' },
      { status: 'PENDING_CONFIRM' },
      { status: 'COMPLETED' },
    ]) {
      const updated = await http(app)
        .patch(`/maintenance/${id}`)
        .set(auth(tenancy.adminToken))
        .send(payload);
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.status).toBe(payload.status);
    }

    const completed = await http(app)
      .get(`/maintenance/${id}`)
      .set(auth(tenancy.adminToken));
    expect(completed.body.resolvedAt).toBeTruthy();

    // 终态不可回退
    const regress = await http(app)
      .patch(`/maintenance/${id}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'IN_PROGRESS' });
    expect(regress.status).toBe(409);

    // 租客只能看到自己的工单
    const mine = await http(app)
      .get('/maintenance/my')
      .set(auth(tenancy.tenantToken));
    expect(mine.status).toBe(200);
    const rows = mine.body.data ?? mine.body;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((row: { id: string }) => row.id === id)).toBe(true);
  });
});

describe.skip('J2 月度计费（待 FIN-02 / T266）', () => {
  it.todo('月付/季付/半年付/年付各生成一张；首期按日折算；重跑幂等');
});

describe.skip('J3 逾期与催缴（待 FIN-04 / T272）', () => {
  it.todo('逾期 +1 天标记；滞纳金按日累计；−3/0/+1/+3/+7 各提醒一次');
});

describe('J4 收款并发与冲正（真实 DB）', () => {
  it('并发不超收；幂等键只记一次；作废生成冲正并回退账单', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const due = new Date();
    due.setDate(due.getDate() + 7);
    const billResponse = await http(app)
      .post('/bills')
      .set(auth(tenancy.adminToken))
      .send({
        contractId: tenancy.contractId,
        billType: 'RENT',
        period: '2099-01',
        amount: 100000,
        dueDate: due.toISOString().slice(0, 10),
        snapshot: { source: 'integration' },
      });
    expect(billResponse.status, JSON.stringify(billResponse.body)).toBe(201);
    const billId = billResponse.body.id as string;

    // 并发两笔 60000：只允许一笔成功，账单不得超收
    const [first, second] = await Promise.all([
      http(app)
        .post(`/bills/${billId}/payments`)
        .set(auth(tenancy.adminToken))
        .send({ amount: 60000, paymentMethod: 'CASH', transactionNumber: 'CONCURRENT-A' }),
      http(app)
        .post(`/bills/${billId}/payments`)
        .set(auth(tenancy.adminToken))
        .send({ amount: 60000, paymentMethod: 'CASH', transactionNumber: 'CONCURRENT-B' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);

    const afterConcurrent = await http(app)
      .get(`/bills/${billId}`)
      .set(auth(tenancy.adminToken));
    expect(afterConcurrent.body.paidAmount).toBe(60000);

    // Idempotency-Key：同键重放返回同一笔收款
    const payIdem = () =>
      http(app)
        .post(`/bills/${billId}/payments`)
        .set(auth(tenancy.adminToken))
        .set('Idempotency-Key', 'itest-idem-1')
        .send({ amount: 10000, paymentMethod: 'CASH' });
    const idem1 = await payIdem();
    const idem2 = await payIdem();
    expect(idem1.status).toBe(201);
    expect(idem2.status).toBe(201);
    expect(idem2.body.payment.id).toBe(idem1.body.payment.id);
    expect(idem1.body.payment.receiptNumber).toMatch(/^R\d{8}\d{6}$/);

    const afterIdem = await http(app)
      .get(`/bills/${billId}`)
      .set(auth(tenancy.adminToken));
    expect(afterIdem.body.paidAmount).toBe(70000);

    // 作废第一笔 60000：生成 -60000 冲正，账单回退到 10000
    const paymentId = (first.status === 201 ? first : second).body.payment.id as string;
    const voided = await http(app)
      .post(`/bills/${billId}/payments/${paymentId}/void`)
      .set(auth(tenancy.adminToken))
      .send({ reason: '集成测试作废' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expect(voided.body.reversal.amount).toBe(-60000);

    const afterVoid = await http(app)
      .get(`/bills/${billId}`)
      .set(auth(tenancy.adminToken));
    expect(afterVoid.body.paidAmount).toBe(10000);
    expect(afterVoid.body.status).toBe('PARTIAL');

    const payments = await http(app)
      .get(`/bills/${billId}/payments`)
      .set(auth(tenancy.adminToken));
    const rows = payments.body as Array<{ id: string; status: string; amount: number }>;
    expect(rows.some((row) => row.id === paymentId && row.status === 'VOIDED')).toBe(true);
    expect(rows.some((row) => row.status === 'REVERSAL' && row.amount === -60000)).toBe(true);

    // 重复作废幂等
    const again = await http(app)
      .post(`/bills/${billId}/payments/${paymentId}/void`)
      .set(auth(tenancy.adminToken))
      .send({ reason: '重复作废' });
    expect(again.status).toBe(201);
    expect(again.body.idempotent).toBe(true);
  });
});

describe('J6 续签（真实 DB）', () => {
  it('旧合同 ACTIVE + 新合同 DRAFT 共存，激活后旧 RENEWED / 新 ACTIVE', async () => {
    const base = await seedBase();
    const tenancy = await setupTenancy(app, base);

    const original = await http(app)
      .get(`/contracts/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(original.status).toBe(200);
    const oldEnd = new Date(original.body.endDate);
    const nextStart = new Date(oldEnd.getTime() + 86_400_000);
    const nextEnd = new Date(nextStart);
    nextEnd.setFullYear(nextEnd.getFullYear() + 1);
    const iso = (date: Date) => date.toISOString().slice(0, 10);

    // 重叠日期必须拒绝
    const overlap = await http(app)
      .post(`/contracts/${tenancy.contractId}/renew`)
      .set(auth(tenancy.adminToken))
      .send({ startDate: iso(oldEnd), endDate: iso(nextEnd) });
    expect(overlap.status).toBe(400);

    // 正常续签：旧合同仍 ACTIVE，新合同 DRAFT（不会再撞唯一索引）
    const renewed = await http(app)
      .post(`/contracts/${tenancy.contractId}/renew`)
      .set(auth(tenancy.adminToken))
      .send({ startDate: iso(nextStart), endDate: iso(nextEnd), rentAmount: 320000 });
    expect(renewed.status, JSON.stringify(renewed.body)).toBe(201);
    expect(renewed.body.status).toBe('DRAFT');
    expect(renewed.body.renewedFromId).toBe(tenancy.contractId);

    // 同一合同不得重复续签
    const again = await http(app)
      .post(`/contracts/${tenancy.contractId}/renew`)
      .set(auth(tenancy.adminToken))
      .send({ startDate: iso(nextStart), endDate: iso(nextEnd) });
    expect(again.status).toBe(409);

    // 激活续签合同：同一事务内旧合同 RENEWED、新合同 ACTIVE
    const activate = await http(app)
      .patch(`/contracts/${renewed.body.id}`)
      .set(auth(tenancy.adminToken))
      .send({ status: 'ACTIVE' });
    expect(activate.status, JSON.stringify(activate.body)).toBe(200);
    expect(activate.body.status).toBe('ACTIVE');

    const oldAfter = await http(app)
      .get(`/contracts/${tenancy.contractId}`)
      .set(auth(tenancy.adminToken));
    expect(oldAfter.body.status).toBe('RENEWED');

    const room = await http(app).get(`/rooms/${tenancy.roomId}`).set(auth(tenancy.adminToken));
    expect(room.body.status).toBe('OCCUPIED');
  });
});

// J7 由 `checkout.int-spec.ts` 覆盖：结算等式、合同终止、房间待清洁、押金归零。
