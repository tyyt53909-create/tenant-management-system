import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { claimPreCreatedTenant, preCreatedTenantWhere } from './pre-created-tenant.js';

describe('preCreatedTenantWhere', () => {
  it('同时有邮箱和手机号时要求命中同一条档案', () => {
    expect(preCreatedTenantWhere({ email: ' A@Example.com ', phone: ' 13800138000 ' })).toEqual({
      userId: null,
      AND: [{ email: { equals: 'a@example.com', mode: 'insensitive' } }, { phone: '13800138000' }],
    });
  });

  it('只有邮箱时不区分大小写', () => {
    expect(preCreatedTenantWhere({ email: 'A@Example.com' })).toEqual({
      userId: null,
      email: { equals: 'a@example.com', mode: 'insensitive' },
    });
  });

  it('只有手机号时精确匹配', () => {
    expect(preCreatedTenantWhere({ phone: '13800138000' })).toEqual({
      userId: null,
      phone: '13800138000',
    });
  });

  it('没有标识时不发查询', () => {
    expect(preCreatedTenantWhere({ email: '  ', phone: '' })).toBeNull();
  });
});

describe('claimPreCreatedTenant', () => {
  it('只在 userId 仍为空时占用', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await claimPreCreatedTenant({ tenant: { updateMany } }, 'tenant-1', 'user-1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant-1', userId: null },
      data: { userId: 'user-1' },
    });
  });

  it('已被占用时抛 409，不把后写当成成功', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(claimPreCreatedTenant({ tenant: { updateMany } }, 'tenant-1', 'user-2')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: ErrorCode.AUTH_PROFILE_ALREADY_BOUND }),
    });
  });
});
