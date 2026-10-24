import { describe, expect, it } from 'vitest';
import type { RedisCommandClient } from './redis.client.js';
import { RedisOtpStore } from './redis-otp.store.js';
import type { OtpRecord } from '../modules/auth/otp-store.js';

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

function record(over: Partial<OtpRecord> = {}): OtpRecord {
  return {
    codeHash: 'c'.repeat(64),
    salt: 'd'.repeat(32),
    expiresAt: Date.now() + 5 * 60 * 1000,
    lastSentAt: Date.now(),
    ...over,
  };
}

describe('RedisOtpStore', () => {
  it('原始值只含哈希，不含明文验证码', async () => {
    const redis = new FakeRedis();
    const store = new RedisOtpStore(redis);
    await store.set('tenant@example.com', record());

    const raw = redis.values.get('otp:tenant@example.com')?.value ?? '';
    expect(raw).toContain('codeHash');
    expect(raw).not.toContain('"code"');
    expect(raw).not.toMatch(/\b\d{6}\b/);
  });

  it('过期记录读取时自动删除', async () => {
    const redis = new FakeRedis();
    const store = new RedisOtpStore(redis);
    await store.set('tenant@example.com', record({ expiresAt: Date.now() - 1 }));

    expect(await store.get('tenant@example.com')).toBeUndefined();
    expect(redis.values.has('otp:tenant@example.com')).toBe(false);
  });

  it('失败计数用独立键与 INCR 原子累加', async () => {
    const redis = new FakeRedis();
    const store = new RedisOtpStore(redis);

    expect(await store.incrementFailedAttempts('tenant@example.com', 60_000)).toBe(1);
    expect(await store.incrementFailedAttempts('tenant@example.com', 60_000)).toBe(2);
    expect(await store.getFailedAttempts('tenant@example.com')).toBe(2);
    expect(redis.values.has('otp:fail:tenant@example.com')).toBe(true);
  });

  it('重置失败计数只删计数器，不影响验证码', async () => {
    const redis = new FakeRedis();
    const store = new RedisOtpStore(redis);
    await store.set('tenant@example.com', record());
    await store.incrementFailedAttempts('tenant@example.com', 60_000);

    await store.resetFailedAttempts('tenant@example.com');

    expect(await store.getFailedAttempts('tenant@example.com')).toBe(0);
    expect(await store.get('tenant@example.com')).toBeDefined();
  });
});
