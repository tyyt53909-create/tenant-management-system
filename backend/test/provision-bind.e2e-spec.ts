/**
 * BE-INT：预建档案条件绑定。
 * 真实 PostgreSQL，覆盖大小写匹配、双标识必须同一条档案、并发抢绑只有一个成功。
 *
 * 运行：在 backend/ 下
 *   DATABASE_URL=postgresql://... npx vitest run --config vitest.config.e2e.ts test/provision-bind.e2e-spec.ts
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimPreCreatedTenant, findPreCreatedTenant } from '../src/modules/auth/pre-created-tenant.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('provision-bind BE-INT 需要 DATABASE_URL，不能把未运行写成通过');
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const stamp = Date.now().toString(36);
const phoneA = `139${stamp.slice(-8)}01`;
const phoneB = `139${stamp.slice(-8)}02`;
const emailA = `Bind.${stamp}@Example.com`;
const emailB = `other.${stamp}@example.com`;

describe('预建档案条件绑定（BE-INT）', () => {
  let userAId = '';
  let userBId = '';
  let tenantAId = '';
  let tenantBId = '';

  beforeAll(async () => {
    const userA = await prisma.user.create({
      data: { role: 'TENANT', email: `user-a-${stamp}@example.com` },
    });
    const userB = await prisma.user.create({
      data: { role: 'TENANT', email: `user-b-${stamp}@example.com` },
    });
    userAId = userA.id;
    userBId = userB.id;
    const tenantA = await prisma.tenant.create({
      data: { name: '预建A', phone: phoneA, email: emailA },
    });
    const tenantB = await prisma.tenant.create({
      data: { name: '预建B', phone: phoneB, email: emailB },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it('邮箱不区分大小写，且不能用 A 的邮箱加 B 的手机号绑到任意档案', async () => {
    const matched = await findPreCreatedTenant(prisma, { email: emailA.toLowerCase() });
    expect(matched?.id).toBe(tenantAId);

    const crossed = await findPreCreatedTenant(prisma, {
      email: emailA,
      phone: phoneB,
    });
    expect(crossed).toBeNull();
  });

  it('并发抢绑同一预建档案只有一个成功，另一个 409，且绑定不被后写覆盖', async () => {
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => claimPreCreatedTenant(tx, tenantAId, userAId)),
      prisma.$transaction((tx) => claimPreCreatedTenant(tx, tenantAId, userBId)),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { getStatus?: () => number; status?: number };
    expect(reason.getStatus?.() ?? reason.status).toBe(409);

    const bound = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantAId } });
    expect([userAId, userBId]).toContain(bound.userId);
    const winner = bound.userId;
    const loser = winner === userAId ? userBId : userAId;
    await expect(
      prisma.$transaction((tx) => claimPreCreatedTenant(tx, tenantAId, loser)),
    ).rejects.toMatchObject({ status: 409 });
    const still = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantAId } });
    expect(still.userId).toBe(winner);
  });
});
