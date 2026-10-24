import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { prisma, createApp, resetDatabase, seedBase, http, auth } from './harness.js';

/** OPS-06 / T279：同一进程内两个实例共享 DB/Redis，会话跨实例可用。 */
let appA: INestApplication;
let appB: INestApplication;

beforeAll(async () => {
  appA = await createApp();
  appB = await createApp();
}, 60_000);

afterAll(async () => {
  await appA?.close();
  await appB?.close();
  await prisma.$disconnect();
});

describe('多实例无状态（OPS-06）', () => {
  it('实例 A 登录的 access token 可在实例 B 使用', async () => {
    await resetDatabase();
    const base = await seedBase();

    const login = await http(appA)
      .post('/auth/login')
      .send({ identifier: base.adminEmail, password: base.adminPassword });
    expect(login.status).toBe(201);
    const token = login.body.accessToken as string;

    const onB = await http(appB).get('/tenants').set(auth(token));
    expect(onB.status).toBe(200);
  });

  it('实例 A 的 refresh cookie 可在实例 B 轮换', async () => {
    await resetDatabase();
    const base = await seedBase();

    const login = await http(appA)
      .post('/auth/login')
      .send({ identifier: base.adminEmail, password: base.adminPassword });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    expect(Array.isArray(cookies)).toBe(true);

    const rawCookie = cookies.map((item) => item.split(';')[0]).join('; ');
    const refreshToken = rawCookie.split('=')[1];
    const refreshed = await http(appB)
      .post('/auth/refresh')
      .send({ refreshToken });
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.accessToken).toBeTruthy();
  });
});
