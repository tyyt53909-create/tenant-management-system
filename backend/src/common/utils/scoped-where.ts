import { ForbiddenException } from '@nestjs/common';

type ScopeKey = 'tenantId' | 'userId';

/**
 * 租客范围条件。
 * Prisma 会把 `{ tenantId: undefined }` 当成没有这个条件，从而查出全部数据。
 * 范围 id 为空时直接 403，不把查询发出去。
 *
 * 返回值类型用 `Record<K, string>` 精确表达「被指定的那个键一定存在」，
 * 计算属性名（`[field]`）无法被 TS 自行证明，故在返回处断言。
 */
export function scopedWhere<K extends ScopeKey, T extends Record<string, unknown>>(
  scopeId: string | null | undefined,
  where: T = {} as T,
  field: K = 'tenantId' as K,
): T & Record<K, string> {
  if (typeof scopeId !== 'string' || scopeId.trim() === '') {
    throw new ForbiddenException('缺少租客身份，拒绝访问');
  }
  return { ...where, [field]: scopeId } as T & Record<K, string>;
}
