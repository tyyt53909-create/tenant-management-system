import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryLoginAttemptStore,
  loginAttemptKey,
  normalizeLoginIdentifier,
} from './login-attempt.store.js';

describe('loginAttemptKey', () => {
  it('规范化大小写与空白后哈希，不泄露原始 identifier', () => {
    expect(normalizeLoginIdentifier('  User@Example.com ')).toBe('user@example.com');
    const key = loginAttemptKey('  User@Example.com ');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('@');
    expect(key).toBe(loginAttemptKey('user@example.com'));
  });
});

describe('MemoryLoginAttemptStore', () => {
  let store: MemoryLoginAttemptStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryLoginAttemptStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('原子累加失败次数', async () => {
    expect(await store.getFailures('tenant@example.com')).toBe(0);
    expect(await store.registerFailure('tenant@example.com', 60_000)).toBe(1);
    expect(await store.registerFailure('tenant@example.com', 60_000)).toBe(2);
    expect(await store.getFailures('tenant@example.com')).toBe(2);
  });

  it('并发失败不会丢失计数', async () => {
    const counts = await Promise.all(
      Array.from({ length: 10 }, () => store.registerFailure('tenant@example.com', 60_000)),
    );
    expect(Math.max(...counts)).toBe(10);
    expect(await store.getFailures('tenant@example.com')).toBe(10);
  });

  it('成功登录后清零', async () => {
    await store.registerFailure('tenant@example.com', 60_000);
    await store.clear('tenant@example.com');
    expect(await store.getFailures('tenant@example.com')).toBe(0);
  });

  it('窗口过期后计数归零', async () => {
    await store.registerFailure('tenant@example.com', 1_000);
    vi.advanceTimersByTime(1_001);
    expect(await store.getFailures('tenant@example.com')).toBe(0);
  });

  it('大小写与空白视为同一账号', async () => {
    await store.registerFailure(' Tenant@Example.com ', 60_000);
    expect(await store.getFailures('tenant@example.com')).toBe(1);
  });
});
