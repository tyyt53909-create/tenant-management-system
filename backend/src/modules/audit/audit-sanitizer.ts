const SENSITIVE_KEY =
  /password|passwordhash|code|token|authorization|cookie|idnumber|idcard|phone|email|secret|apikey|privatekey|session/i;
export const REDACTED = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, ''));
}

/**
 * 递归深度脱敏：遍历对象与数组，对密码、Token、证件、手机等敏感字段统一置换为 [REDACTED]，
 * 保护审计日志入库安全，避免敏感信息泄露。支持循环引用防护。
 */
export function sanitizeAuditValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : sanitizeAuditValue(child, seen);
  }
  return result;
}
