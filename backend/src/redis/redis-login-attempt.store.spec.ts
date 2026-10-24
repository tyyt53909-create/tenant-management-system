import { describe, expect, it } from 'vitest';
import type { RedisCommandClient } from './redis.client.js';
import { loginAttemptKey } from '../modules/auth/login-attempt.store.js';
import { RedisLoginAttemptStore } from './redis-login-attempt.store.js';

class FakeRedis implements RedisCommandClient {
  readonly values = new Map<string, { value: string; expiresAt: number }>();

  async connect() {
    return 'OK';
  }

  async quit() {
    return 'OK';
  }

  async ping() {
    return 'PONG';
  }

  async get(key: string) {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.value;
  }

  async set(key: string, value: string, _mode: 'PX', ttlMs: number) {
    this.values.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async del(key: string) {
    return this.values.delete(key) ? 1 : 0;
  }

  async incr(key: string) {
    const current = Number((await this.get(key)) ?? 0);
    const next = current + 1;
    const existing = this.values.get(key);
    this.values.set(key, {
      value: String(next),
      expiresAt: existing?.expiresAt ?? Date.now() + 60_000,
    });
    return next;
  }

  async pexpire(key: string, ttlMs: number) {
    const entry = this.values.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + ttlMs;
    return 1;
  }

  async pttl(key: string) {
    const entry = this.values.get(key);
    if (!entry) return -2;
    return Math.max(entry.expiresAt - Date.now(), 0);
  }
}

describe('RedisLoginAttemptStore', () => {
  it('用 INCR 原子累加并刷新 TTL', async () => {
    const redis = new FakeRedis();
    const store = new RedisLoginAttemptStore(redis);

    expect(await store.registerFailure('tenant@example.com', 60_000)).toBe(1);
    expect(await store.registerFailure('tenant@example.com', 60_000)).toBe(2);
    expect(await store.getFailures('tenant@example.com')).toBe(2);

    const key = [...redis.values.keys()][0];
    expect(key).toMatch(/^login:fail:[0-9a-f]{64}$/);
    expect(key).not.toContain('@');
    expect(await redis.pttl(key)).toBeGreaterThan(50_000);
  });

  it('清零后计数为 0', async () => {
    const redis = new FakeRedis();
    const store = new RedisLoginAttemptStore(redis);
    await store.registerFailure('tenant@example.com', 60_000);
    await store.clear('tenant@example.com');
    expect(await store.getFailures('tenant@example.com')).toBe(0);
  });

  it('非法计数值按 0 处理', async () => {
    const redis = new FakeRedis();
    const store = new RedisLoginAttemptStore(redis);
    await redis.set(`login:fail:${loginAttemptKey('abc')}`, 'not-a-number', 'PX', 60_000);
    expect(await store.getFailures('abc')).toBe(0);
  });
});
