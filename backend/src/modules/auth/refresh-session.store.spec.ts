import { describe, expect, it } from 'vitest';
import type { RedisCommandClient } from '../../redis/redis.client.js';
import {
  MemoryRefreshSessionStore,
  RedisRefreshSessionStore,
  type RefreshSession,
} from './refresh-session.store.js';

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
  async set(key: string, value: string, _mode: 'PX', ttlMs: number, condition?: 'NX') {
    // 实现 SET ... NX 语义（ioredis 命中已存在的键时返回 null）
    if (condition === 'NX' && (await this.get(key)) !== null) return null;
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

function activeSession(over: Partial<RefreshSession> = {}): RefreshSession {
  return {
    jti: 'jti-1',
    userId: 'user-1',
    familyId: 'family-1',
    expiresAt: Date.now() + 60_000,
    status: 'active',
    ...over,
  };
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

  it('rotate：同一 jti 只有第一次成功，且会记下 rotatedAt（T208 并发防重）', async () => {
    const redis = new FakeRedis();
    const store = new RedisRefreshSessionStore(redis);
    await store.save(activeSession());

    const first = await store.rotate('jti-1', 'jti-2');
    expect(first.rotated).toBe(true);
    expect(first.rotatedAt).toBeGreaterThan(0);

    // 并发输家：同一 jti 再轮换必须失败，但必须拿到赢家的轮换时刻（否则会被误判成重放）
    const loser = await store.rotate('jti-1', 'jti-3');
    expect(loser.rotated).toBe(false);
    expect(loser.rotatedAt).toBe(first.rotatedAt);

    const session = await store.get('jti-1');
    expect(session?.status).toBe('rotated');
    expect(session?.replacedBy).toBe('jti-2');
    expect(session?.rotatedAt).toBeGreaterThan(0);
  });

  it('rotate：标记键先于会话本体写入，会话本体尚未回写时输家也能拿到轮换时刻（T208 补修）', async () => {
    const redis = new FakeRedis();
    const store = new RedisRefreshSessionStore(redis);
    await store.save(activeSession());

    // 手工模拟「赢家已写标记、会话本体还没回写」的中间态
    await redis.set('refresh:rotated:jti-1', String(Date.now()), 'PX', 60_000, 'NX');

    const loser = await store.rotate('jti-1', 'jti-9');
    expect(loser.rotated).toBe(false);
    expect(loser.rotatedAt).toBeGreaterThan(0);
  });

  it('rotate：不存在或非 active 的会话一律返回未轮换', async () => {
    const redis = new FakeRedis();
    const store = new RedisRefreshSessionStore(redis);

    expect((await store.rotate('missing', 'x')).rotated).toBe(false);

    await store.save(activeSession({ status: 'rotated' }));
    expect((await store.rotate('jti-1', 'x')).rotated).toBe(false);
  });

  it('MemoryRefreshSessionStore.rotate 同样只成功一次，并回报轮换时刻', async () => {
    const store = new MemoryRefreshSessionStore();
    await store.save(activeSession());

    const first = await store.rotate('jti-1', 'jti-2');
    expect(first.rotated).toBe(true);

    const loser = await store.rotate('jti-1', 'jti-3');
    expect(loser.rotated).toBe(false);
    expect(loser.rotatedAt).toBe(first.rotatedAt);
    expect((await store.get('jti-1'))?.status).toBe('rotated');
  });
});
