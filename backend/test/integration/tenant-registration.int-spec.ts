import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, login, http, auth } from './harness.js';

/** SEC-08 / T271：证件登记写入、脱敏与查看留痕（真实 DB） */
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

const ID_NUMBER = '440101199001011234';

async function setup() {
  const base = await seedBase();
  const token = await login(app, base.adminEmail, base.adminPassword);
  return { base, token };
}

let sequence = 0;
function tenantPayload(overrides: Record<string, unknown> = {}) {
  sequence += 1;
  const suffix = `${String(Date.now()).slice(-5)}${String(sequence).padStart(3, '0')}`;
  return {
    name: '登记测试租客',
    phone: `139${suffix}`,
    email: `reg-${suffix}@example.com`,
    ...overrides,
  };
}

describe('证件登记与个资留痕（SEC-08）', () => {
  it('创建带证件号 → 列表/详情只返回脱敏值 → 明文查看有审计且不含明文', async () => {
    const { token } = await setup();

    const created = await http(app)
      .post('/tenants')
      .set(auth(token))
      .send(tenantPayload({ idType: 'ID_CARD', idNumber: ID_NUMBER }));
    expect(created.status).toBe(201);
    expect(created.body.idNumberMasked).toBe('4401**********1234');
    expect(JSON.stringify(created.body)).not.toContain(ID_NUMBER);

    const list = await http(app).get('/tenants').set(auth(token));
    expect(list.status).toBe(200);
    const row = list.body.data.find((item: { id: string }) => item.id === created.body.id);
    expect(row.idNumberMasked).toBe('4401**********1234');
    expect(JSON.stringify(row)).not.toContain(ID_NUMBER);

    const reveal = await http(app)
      .get(`/tenants/${created.body.id}/id-number`)
      .set(auth(token));
    expect(reveal.status).toBe(200);
    expect(reveal.body.idNumber).toBe(ID_NUMBER);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'VIEW_ID_NUMBER', entityType: 'TenantRegistration' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.changes)).not.toContain(ID_NUMBER);
    expect(JSON.stringify(audit?.changes)).not.toContain('4401**********1234');
  });

  it('同一证件号不能登记到第二个租客（409），证件类型必须成对（400）', async () => {
    const { token } = await setup();
    const first = await http(app)
      .post('/tenants')
      .set(auth(token))
      .send(tenantPayload({ idType: 'ID_CARD', idNumber: ID_NUMBER }));
    expect(first.status).toBe(201);

    const duplicate = await http(app)
      .post('/tenants')
      .set(auth(token))
      .send(tenantPayload({ idType: 'ID_CARD', idNumber: ID_NUMBER }));
    expect(duplicate.status).toBe(409);

    const onlyNumber = await http(app)
      .post('/tenants')
      .set(auth(token))
      .send(tenantPayload({ idNumber: ID_NUMBER }));
    expect(onlyNumber.status).toBe(400);
  });

  it('登记状态前进写 registeredAt，非法回退 409；只改状态不动证件号', async () => {
    const { token } = await setup();
    const created = await http(app)
      .post('/tenants')
      .set(auth(token))
      .send(tenantPayload({ idType: 'ID_CARD', idNumber: ID_NUMBER }));
    const tenantId = created.body.id as string;

    const registered = await http(app)
      .put(`/tenants/${tenantId}/registration`)
      .set(auth(token))
      .send({ idType: 'ID_CARD', status: 'REGISTERED' });
    expect(registered.status).toBe(200);
    expect(registered.body).toMatchObject({
      status: 'REGISTERED',
      idNumberMasked: '4401**********1234',
    });
    expect(registered.body.registeredAt).toBeTruthy();

    const back = await http(app)
      .put(`/tenants/${tenantId}/registration`)
      .set(auth(token))
      .send({ idType: 'ID_CARD', status: 'NOT_REGISTERED' });
    expect(back.status).toBe(409);

    const before = await prisma.tenantRegistration.findUniqueOrThrow({ where: { tenantId } });
    const statusOnly = await http(app)
      .put(`/tenants/${tenantId}/registration`)
      .set(auth(token))
      .send({ idType: 'ID_CARD', status: 'PENDING' });
    expect(statusOnly.status).toBe(200);
    expect(statusOnly.body.idNumberMasked).toBe('4401**********1234');

    const after = await prisma.tenantRegistration.findUniqueOrThrow({ where: { tenantId } });
    expect(after.idNumber).toBe(before.idNumber);
    expect(after.idNumberHash).toBe(before.idNumberHash);
    expect(after.status).toBe('PENDING');
  });

  it('更新租客证件号后旧号码可给新租客使用，响应仍只给脱敏值', async () => {
    const { token } = await setup();
    const created = await http(app)
      .post('/tenants')
      .set(auth(token))
      .send(tenantPayload({ idType: 'ID_CARD', idNumber: ID_NUMBER }));
    const tenantId = created.body.id as string;

    const newNumber = '440101199202022345';
    const updated = await http(app)
      .patch(`/tenants/${tenantId}`)
      .set(auth(token))
      .send({ idType: 'ID_CARD', idNumber: newNumber });
    expect(updated.status).toBe(200);
    expect(updated.body.idNumberMasked).toBe('4401**********2345');
    expect(JSON.stringify(updated.body)).not.toContain(newNumber);

    const reuseOld = await http(app)
      .post('/tenants')
      .set(auth(token))
      .send(tenantPayload({ idType: 'ID_CARD', idNumber: ID_NUMBER }));
    expect(reuseOld.status).toBe(201);
  });
});
