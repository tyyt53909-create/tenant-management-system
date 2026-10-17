import { describe, expect, it } from 'vitest';
import { resolveThrottleLimits, resolveTrustProxy, THROTTLE_DEFAULTS } from './throttle.config.js';

describe('resolveThrottleLimits', () => {
  it('生产环境使用默认次数', () => {
    const limits = resolveThrottleLimits({ NODE_ENV: 'production' });
    expect(limits.global.limit).toBe(THROTTLE_DEFAULTS.global.limit);
    expect(limits.auth.limit).toBe(10);
    expect(limits.otp.limit).toBe(5);
    expect(limits.otp.ttl).toBe(60 * 60 * 1000);
  });

  it('测试环境未显式设置时抬高次数', () => {
    const limits = resolveThrottleLimits({ NODE_ENV: 'test' });
    expect(limits.global.limit).toBe(100_000);
    expect(limits.auth.limit).toBe(100_000);
    expect(limits.otp.limit).toBe(100_000);
  });

  it('显式环境变量优先于测试环境的抬高值', () => {
    const limits = resolveThrottleLimits({
      NODE_ENV: 'test',
      THROTTLE_GLOBAL_LIMIT: '3',
      THROTTLE_AUTH_LIMIT: '10',
      THROTTLE_OTP_LIMIT: '5',
    });
    expect(limits.global.limit).toBe(3);
    expect(limits.auth.limit).toBe(10);
    expect(limits.otp.limit).toBe(5);
  });

  it('非法次数回退到默认值', () => {
    const limits = resolveThrottleLimits({
      NODE_ENV: 'production',
      THROTTLE_AUTH_LIMIT: '0',
    });
    expect(limits.auth.limit).toBe(10);
  });
});

describe('resolveTrustProxy', () => {
  it('未设置时，生产信任一层代理，其它环境关闭', () => {
    expect(resolveTrustProxy(undefined, 'production')).toBe(1);
    expect(resolveTrustProxy('  ', 'production')).toBe(1);
    expect(resolveTrustProxy(undefined, 'development')).toBe(false);
    expect(resolveTrustProxy(undefined, 'test')).toBe(false);
  });

  it('接受 false、true 和正整数跳数', () => {
    expect(resolveTrustProxy('false', 'production')).toBe(false);
    expect(resolveTrustProxy('0', 'production')).toBe(false);
    expect(resolveTrustProxy('true', 'development')).toBe(true);
    expect(resolveTrustProxy('2', 'development')).toBe(2);
    expect(resolveTrustProxy('nope', 'production')).toBe(false);
  });
});
