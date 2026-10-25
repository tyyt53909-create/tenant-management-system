import { describe, expect, it } from 'vitest';
import { decideInviteClaim } from './claim-invite.js';

const tenant = {
  id: 'tenant-a',
  email: 'a@example.com',
  phone: '13800000001',
  userId: null,
};

describe('decideInviteClaim', () => {
  it('自己的邀请码加别人的邮箱时拒绝', () => {
    expect(() =>
      decideInviteClaim({
        invite: { role: 'TENANT', tenantId: 'tenant-a' },
        verifiedEmail: 'b@example.com',
        tenant,
      }),
    ).toThrow(/不一致/);
  });

  it('未验证手机号不能单独选档', () => {
    expect(() =>
      decideInviteClaim({
        invite: { role: 'TENANT', tenantId: 'tenant-a' },
        verifiedEmail: '',
        suppliedPhone: '13800000001',
        tenant,
      }),
    ).toThrow(/不一致/);
  });

  it('没有指定档案的租客邀请拒绝', () => {
    expect(() =>
      decideInviteClaim({
        invite: { role: 'TENANT', tenantId: null },
        verifiedEmail: 'a@example.com',
        tenant,
      }),
    ).toThrow(/必须指定/);
  });

  it('职员邀请不认领租客', () => {
    expect(
      decideInviteClaim({
        invite: { role: 'ADMIN', tenantId: null },
        verifiedEmail: 'a@example.com',
        tenant,
      }),
    ).toEqual({ kind: 'staff', role: 'ADMIN' });
  });

  it('验证邮箱命中指定档案时允许认领', () => {
    expect(
      decideInviteClaim({
        invite: { role: 'TENANT', tenantId: 'tenant-a' },
        verifiedEmail: 'A@Example.com',
        suppliedPhone: '13800000001',
        tenant,
      }),
    ).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
  });
});
