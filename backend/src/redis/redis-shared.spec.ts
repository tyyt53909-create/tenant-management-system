import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { OtpRecord } from '../modules/auth/otp-store.js';
import type { RedisCommandClient } from './redis.client.js';
import { RedisOtpStore } from './redis-otp.store.js';
import { RedisService } from './redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

class SharedRedis implements RedisCommandClient {
  readonly values = new Map<string, { value: string; expiresAt: number }>();
  readonly counters = new Map<string, { hits: number; expiresAt: number }>();

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
    this.values.delete(key);
    return 1;
  }

  async incr(key: string) {
    const current = this.counters.get(key);
    if (!current || current.expiresAt <= Date.now()) {
      this.counters.set(key, { hits: 1, expiresAt: Date.now() + 60_000 });
      return 1;
    }
    current.hits += 1;
    return current.hits;
  }

  async pexpire(key: string, ttlMs: number) {
    const current = this.counters.get(key);
    if (current) current.expiresAt = Date.now() + ttlMs;
    return 1;
  }

  async pttl(key: string) {
    const current = this.counters.get(key);
    if (!current) return -2;
    return Math.max(current.expiresAt - Date.now(), 0);
  }
}

const record: OtpRecord = {
  code: '654321',
  expiresAt: Date.now() + 60_000,
  lastSentAt: Date.now(),
  failedAttempts: 0,
};

describe('两个实例共享 Redis 状态', () => {
  it('实例 A 写入的验证码可以被实例 B 读到', async () => {
    const redis = new SharedRedis();
    const instanceA = new RedisOtpStore(redis);
    const instanceB = new RedisOtpStore(redis);

    await instanceA.set('tenant@example.com', record);

    expect(await instanceB.get('tenant@example.com')).toMatchObject({ code: '654321' });
  });

  it('重启后未过期的验证码仍有效（新实例等于重启后的进程状态，T212 补验 OPT-08）', async () => {
    const redis = new SharedRedis();
    const beforeRestart = new RedisOtpStore(redis);
    await beforeRestart.set('restart@example.com', { ...record, code: '135790' });

    // 重启：内存态全部丢弃，只留 Redis 里的副本
    const afterRestart = new RedisOtpStore(redis);

    expect(await afterRestart.get('restart@example.com')).toMatchObject({ code: '135790' });
  });

  it('已过期的验证码重启后读不到（TTL 生效）', async () => {
    const redis = new SharedRedis();
    const beforeRestart = new RedisOtpStore(redis);
    await beforeRestart.set('expired@example.com', { ...record, expiresAt: Date.now() - 1 });

    const afterRestart = new RedisOtpStore(redis);

    expect(await afterRestart.get('expired@example.com')).toBeUndefined();
  });

  it('两个限流存储共享计数，超过阈值都返回阻断', async () => {
    const redis = new SharedRedis();
    const instanceA = new RedisThrottlerStorage(redis);
    const instanceB = new RedisThrottlerStorage(redis);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await instanceA.increment('ip:203.0.113.10', 60_000, 10, 60_000, 'default');
      expect(result.isBlocked).toBe(false);
    }

    const blocked = await instanceB.increment('ip:203.0.113.10', 60_000, 10, 60_000, 'default');
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.totalHits).toBe(11);
    expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
  });
});

describe('RedisService 启动策略', () => {
  it('生产环境连不上 Redis 时拒绝启动', async () => {
    const service = new RedisService(
      new ConfigService({ NODE_ENV: 'production', REDIS_HOST: '127.0.0.1', REDIS_PORT: '1' }),
    );
    await expect(service.connect()).rejects.toThrow(/生产环境无法连接 Redis/);
  });

  it('开发环境连不上 Redis 时降级，不抛错', async () => {
    const service = new RedisService(
      new ConfigService({ NODE_ENV: 'development', REDIS_HOST: '127.0.0.1', REDIS_PORT: '1' }),
    );
    await service.connect();
    expect(service.ready).toBe(false);
    expect(service.client).toBeNull();
  });
});
