import type { UserRole } from '@prisma/client';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { normalizeEmail, normalizePhone } from '../../common/utils/normalize-contact.js';

export interface ClaimTenantRecord {
  id: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
}

export interface InviteClaimSource {
  role?: UserRole | null;
  tenantId?: string | null;
}

export type InviteClaimDecision =
  | { kind: 'staff'; role: UserRole }
  | { kind: 'tenant'; tenantId: string };

/**
 * 邀请码决定认领哪一份档案。已验证邮箱必须命中该档案。
 * 手机号不能单独选档；给出时只能核对，不能改指向。
 * 职员邀请不能绑定租客，也不能借租客流程提升角色。
 */
export function decideInviteClaim(input: {
  invite: InviteClaimSource;
  verifiedEmail: string;
  suppliedPhone?: string | null;
  tenant: ClaimTenantRecord | null;
}): InviteClaimDecision {
  const role = input.invite.role ?? 'TENANT';
  if (role !== 'TENANT') {
    if (input.invite.tenantId) {
      throw apiError(ErrorCode.AUTH_INVITE_TARGET_MISMATCH, '职员邀请不能绑定租客档案');
    }
    return { kind: 'staff', role };
  }

  if (!input.invite.tenantId) {
    throw apiError(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED, '租客邀请必须指定预建档案');
  }
  const tenant = input.tenant;
  if (!tenant || tenant.id !== input.invite.tenantId) {
    throw apiError(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED, '邀请指向的预建档案不存在');
  }
  if (tenant.userId) {
    throw apiError(ErrorCode.AUTH_PROFILE_ALREADY_BOUND);
  }

  const verified = normalizeEmail(input.verifiedEmail);
  const tenantEmail = normalizeEmail(tenant.email);
  if (!verified || !tenantEmail || verified !== tenantEmail) {
    throw apiError(ErrorCode.AUTH_INVITE_TARGET_MISMATCH, '验证邮箱与邀请档案不一致');
  }

  const supplied = normalizePhone(input.suppliedPhone);
  const tenantPhone = normalizePhone(tenant.phone);
  if (supplied && tenantPhone && supplied !== tenantPhone) {
    throw apiError(ErrorCode.AUTH_INVITE_TARGET_MISMATCH, '手机号与邀请档案不一致');
  }

  return { kind: 'tenant', tenantId: tenant.id };
}

/**
 * 手机号验证场景下的邀请码选档认领（WX-03 / T292）。
 * 验证手机号必须严格命中预建档案的手机号。
 */
export function decidePhoneInviteClaim(input: {
  invite: InviteClaimSource;
  verifiedPhone: string;
  tenant: ClaimTenantRecord | null;
}): InviteClaimDecision {
  const role = input.invite.role ?? 'TENANT';
  if (role !== 'TENANT') {
    if (input.invite.tenantId) {
      throw apiError(ErrorCode.AUTH_INVITE_TARGET_MISMATCH, '职员邀请不能绑定租客档案');
    }
    return { kind: 'staff', role };
  }

  if (!input.invite.tenantId) {
    throw apiError(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED, '租客邀请必须指定预建档案');
  }
  const tenant = input.tenant;
  if (!tenant || tenant.id !== input.invite.tenantId) {
    throw apiError(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED, '邀请指向的预建档案不存在');
  }
  if (tenant.userId) {
    throw apiError(ErrorCode.AUTH_PROFILE_ALREADY_BOUND);
  }

  const verified = normalizePhone(input.verifiedPhone);
  const tenantPhone = normalizePhone(tenant.phone);
  if (!verified || !tenantPhone || verified !== tenantPhone) {
    throw apiError(ErrorCode.AUTH_INVITE_TARGET_MISMATCH, '验证手机号与邀请档案不一致');
  }

  return { kind: 'tenant', tenantId: tenant.id };
}
