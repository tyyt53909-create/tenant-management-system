import { ForbiddenException } from '@nestjs/common';

/**
 * 租客范围条件。
 * Prisma 会把 `{ tenantId: undefined }` 当成没有这个条件，从而查出全部数据。
 * 范围 id 为空时直接 403，不把查询发出去。
 */
export function scopedWhere<T extends Record<string, unknown>>(
  scopeId: string | null | undefined,
  where: T = {} as T,
  field: 'tenantId' | 'userId' = 'tenantId',
): T & Record<'tenantId' | 'userId', string> {
  if (typeof scopeId !== 'string' || scopeId.trim() === '') {
    throw new ForbiddenException('缺少租客身份，拒绝访问');
  }
  return { ...where, [field]: scopeId };
}
