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
