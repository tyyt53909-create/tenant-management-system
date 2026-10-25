import type { Prisma } from '@prisma/client';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { normalizeEmail, normalizePhone } from '../../common/utils/normalize-contact.js';

export interface PreCreatedIdentity {
  email?: string | null;
  phone?: string | null;
}

type TenantClaimer = {
  tenant: {
    updateMany: (args: {
      where: { id: string; userId: null };
      data: { userId: string };
    }) => Promise<{ count: number }>;
  };
};

/**
 * 预建租客匹配条件。
 * 只给一个标识时按该标识匹配；邮箱和手机号都给出时必须命中同一条档案，
 * 避免 OR + findFirst 把 A 的邮箱和 B 的手机号绑到任意一份档案上。
 * 邮箱不区分大小写，以覆盖尚未回填成小写的存量数据。
 */
export function preCreatedTenantWhere(identity: PreCreatedIdentity): Prisma.TenantWhereInput | null {
  const email = normalizeEmail(identity.email);
  const phone = normalizePhone(identity.phone);
  if (!email && !phone) return null;

  const where: Prisma.TenantWhereInput = { userId: null };
  if (email && phone) {
    where.AND = [{ email: { equals: email, mode: 'insensitive' } }, { phone }];
  } else if (email) {
    where.email = { equals: email, mode: 'insensitive' };
  } else if (phone) {
    where.phone = phone;
  }
  return where;
}

export async function findPreCreatedTenant<T extends { id: string }>(
  db: { tenant: { findFirst: (args: { where: Prisma.TenantWhereInput }) => Promise<T | null> } },
  identity: PreCreatedIdentity,
): Promise<T | null> {
  const where = preCreatedTenantWhere(identity);
  if (!where) return null;
  return db.tenant.findFirst({ where });
}

/**
 * 在事务内占用一份尚未绑定的预建档案。
 * where 带 userId: null，后写不能覆盖先写；失败时抛 409，由外层事务回滚建号和邀请码核销。
 */
export async function claimPreCreatedTenant(
  tx: TenantClaimer,
  tenantId: string,
  userId: string,
): Promise<void> {
  const claimed = await tx.tenant.updateMany({
    where: { id: tenantId, userId: null },
    data: { userId },
  });
  if (claimed.count !== 1) {
    throw apiError(ErrorCode.AUTH_PROFILE_ALREADY_BOUND);
  }
}

