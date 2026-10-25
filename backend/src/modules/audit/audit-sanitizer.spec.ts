import { describe, expect, it } from 'vitest';
import { isSensitiveKey, sanitizeAuditValue, REDACTED } from './audit-sanitizer.js';

describe('AuditSanitizer 脱敏测试（T323 - R09）', () => {
  it('识别各类敏感键名变体', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('passwordHash')).toBe(true);
    expect(isSensitiveKey('user_password')).toBe(true);
    expect(isSensitiveKey('accessToken')).toBe(true);
    expect(isSensitiveKey('refreshToken')).toBe(true);
    expect(isSensitiveKey('idCard')).toBe(true);
    expect(isSensitiveKey('id_number')).toBe(true);
    expect(isSensitiveKey('phone')).toBe(true);
    expect(isSensitiveKey('userEmail')).toBe(true);
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('secretKey')).toBe(true);

    // 非敏感字段
    expect(isSensitiveKey('username')).toBe(false);
    expect(isSensitiveKey('amount')).toBe(false);
    expect(isSensitiveKey('status')).toBe(false);
    expect(isSensitiveKey('createdAt')).toBe(false);
  });

  it('对嵌套对象与数组中的敏感信息进行递归脱敏', () => {
    const input = {
      action: 'BILL_PAYMENT',
      amount: 50000,
      user: {
        id: 'u-1',
        name: '张三',
        email: 'zhangsan@example.com',
        nested: {
          password: 'Tenant@123',
          role: 'TENANT',
        },
      },
      tenants: [
        { id: 't-1', phone: '13800000001', note: '测试1' },
        { id: 't-2', phone: '13800000002', note: '测试2' },
      ],
      tokens: ['token-abc', 'token-def'],
    };

    const sanitized: any = sanitizeAuditValue(input);

    expect(sanitized.action).toBe('BILL_PAYMENT');
    expect(sanitized.amount).toBe(50000);
    expect(sanitized.user.name).toBe('张三');
    expect(sanitized.user.email).toBe(REDACTED);
    expect(sanitized.user.nested.password).toBe(REDACTED);
    expect(sanitized.user.nested.role).toBe('TENANT');

    expect(sanitized.tenants[0].phone).toBe(REDACTED);
    expect(sanitized.tenants[0].note).toBe('测试1');
    expect(sanitized.tenants[1].phone).toBe(REDACTED);
    expect(sanitized.tenants[1].note).toBe('测试2');
  });

  it('安全处理循环引用对象，避免死循环栈溢出', () => {
    const circular: any = { name: 'cycle' };
    circular.self = circular;

    const sanitized: any = sanitizeAuditValue(circular);
    expect(sanitized.name).toBe('cycle');
    expect(sanitized.self).toBe('[Circular]');
  });

  it('原始值与空值原样返回', () => {
    expect(sanitizeAuditValue(null)).toBeNull();
    expect(sanitizeAuditValue(undefined)).toBeUndefined();
    expect(sanitizeAuditValue('hello')).toBe('hello');
    expect(sanitizeAuditValue(123)).toBe(123);
    expect(sanitizeAuditValue(true)).toBe(true);
  });
});
