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

describe.skip('J4 收款并发与冲正（待 FIN-05 / T264）', () => {
  it.todo('并发收款不超收；同 Idempotency-Key 只记一次；作废产生冲正');
});

describe.skip('J6 续签（待 FIN-01 / T263）', () => {
  it.todo('续签不 409；日期不重叠；旧合同 RENEWED、新合同次日 ACTIVE');
});

describe.skip('J7 退租→保洁→可租（待 FIN-07 / T273）', () => {
  it.todo('结算等式成立；任一步失败整笔回滚；押金台账归零');
});
