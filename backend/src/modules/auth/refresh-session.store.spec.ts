import { describe, expect, it } from 'vitest';
import type { RedisCommandClient } from '../../redis/redis.client.js';
import { RedisRefreshSessionStore, type RefreshSession } from './refresh-session.store.js';

class FakeRedis implements RedisCommandClient {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  async connect() { return 'OK'; }
  async quit() { return 'OK'; }
  async ping() { return 'PONG'; }
  async incr() { return 1; }
  async pexpire() { return 1; }
  async del(key: string) {
    this.values.delete(key);
    return 1;
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
  async pttl(key: string) {
    const entry = this.values.get(key);
    if (!entry) return -2;
    return Math.max(entry.expiresAt - Date.now(), 0);
  }
  expiresAt(key: string) {
    return this.values.get(key)?.expiresAt;
  }
}

describe('RedisRefreshSessionStore', () => {
  it('写入即将过期的旧会话时，不缩短用户索引的存活时间', async () => {
    const redis = new FakeRedis();
    const store = new RedisRefreshSessionStore(redis);
    const now = Date.now();
    const fresh: RefreshSession = {
      jti: 'new',
      userId: 'user-1',
      familyId: 'family-1',
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
      status: 'active',
    };
    const expiring: RefreshSession = {
      jti: 'old',
      userId: 'user-1',
      familyId: 'family-1',
      expiresAt: now + 60_000,
      status: 'rotated',
      replacedBy: 'new',
    };

    await store.save(fresh);
    const indexExpiry = redis.expiresAt('refresh:user:user-1');
    await store.save(expiring);

    expect(redis.expiresAt('refresh:user:user-1')).toBeGreaterThanOrEqual((indexExpiry ?? 0) - 50);
    await store.revokeUser('user-1');
    expect(await store.get('new')).toBeUndefined();
    expect(await store.get('old')).toBeUndefined();
  });
});
