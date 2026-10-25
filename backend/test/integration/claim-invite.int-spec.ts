import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { EmailOtpService } from '../../src/modules/auth/email-otp.service.js';
import { auth, createApp, http, login, prisma, resetDatabase, seedBase } from './harness.js';

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

async function createTenant(adminToken: string, email: string, phone: string) {
  const response = await http(app)
    .post('/tenants')
    .set(auth(adminToken))
    .send({ name: email, phone, email });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

describe('租客认领必须命中邀请档案', () => {
  it('自己的邀请码加别人的已验证邮箱时拒绝，且不建账号', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);
    const tenantA = await createTenant(adminToken, 'a-claim@example.com', '13800001001');
    await createTenant(adminToken, 'b-claim@example.com', '13800001002');

    const invite = await http(app)
      .post('/auth/invite-codes')
      .set(auth(adminToken))
      .send({ role: 'TENANT', tenantId: tenantA, expiryDays: 1 });
    expect(invite.status).toBe(201);
    const inviteCode = (invite.body.inviteCode ?? invite.body.code) as string;

    await app.get(EmailOtpService).seedCodeForTests('b-claim@example.com', '111111');
    const rejected = await http(app).post('/auth/register').send({
      email: 'b-claim@example.com',
      password: 'Tenant@123',
      inviteCode,
      emailCode: '111111',
    });
    expect(rejected.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: 'b-claim@example.com' } })).toBeNull();
    expect(await prisma.tenant.findUnique({ where: { id: tenantA } })).toMatchObject({ userId: null });
  });

  it('验证邮箱命中指定档案后可以注册，同一邀请码不能再用', async () => {
    const base = await seedBase();
    const adminToken = await login(app, base.adminEmail, base.adminPassword);
    const tenantA = await createTenant(adminToken, 'ok-claim@example.com', '13800001003');
    const invite = await http(app)
      .post('/auth/invite-codes')
      .set(auth(adminToken))
      .send({ role: 'TENANT', tenantId: tenantA, expiryDays: 1 });
    const inviteCode = invite.body.inviteCode as string;

    await app.get(EmailOtpService).seedCodeForTests('ok-claim@example.com', '222222');
    const created = await http(app).post('/auth/register').send({
      email: 'ok-claim@example.com',
      password: 'Tenant@123',
      inviteCode,
      emailCode: '222222',
    });
    expect(created.status).toBe(201);

    await app.get(EmailOtpService).seedCodeForTests('ok-claim@example.com', '333333');
    const reused = await http(app).post('/auth/register').send({
      email: 'ok-claim@example.com',
      password: 'Tenant@123',
      inviteCode,
      emailCode: '333333',
    });
    expect(reused.status).toBeGreaterThanOrEqual(400);
  });
});
