/**
 * 联系方式规范化（SEC-04 / T260，QLT-04 T289 共享版）。
 *
 * 后端入库与比对、前端/小程序提交前都必须经过同一套规范化，
 * 避免大小写与空白差异造成「同一邮箱绑不上预建档案」。
 */

/** 邮箱比对与入库前的统一规范化：去空白并小写。空串视为未提供。 */
export function normalizeEmail(email?: string | null): string | undefined {
  const value = email?.trim().toLowerCase();
  return value ? value : undefined;
}

/** 手机号只去空白，不做格式改写。空串视为未提供。 */
export function normalizePhone(phone?: string | null): string | undefined {
  const value = phone?.trim();
  return value ? value : undefined;
}
