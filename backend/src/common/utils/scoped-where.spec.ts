import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { scopedWhere } from './scoped-where.js';

describe('scopedWhere', () => {
  it('拼出带 tenantId 的条件', () => {
    expect(scopedWhere('tenant-1', { status: 'PENDING' })).toEqual({
      status: 'PENDING',
      tenantId: 'tenant-1',
    });
  });

  it('可以改成按 userId 限定', () => {
    expect(scopedWhere('user-1', { isRead: false }, 'userId')).toEqual({
      isRead: false,
      userId: 'user-1',
    });
  });

  it('空身份抛 403，不返回可被 Prisma 忽略的 undefined', () => {
    for (const id of [undefined, null, '', '   ']) {
      expect(() => scopedWhere(id as never, { status: 'PENDING' })).toThrow(ForbiddenException);
    }
  });
});
