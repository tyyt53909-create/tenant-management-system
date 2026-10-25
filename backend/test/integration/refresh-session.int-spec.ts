import { afterAll, describe, expect, it } from 'vitest';
import RedisImport from 'ioredis';
import { RedisRefreshSessionStore, type RefreshSession } from '../../src/modules/auth/refresh-session.store.js';

const Redis = RedisImport as unknown as new (url: string) => {
  eval(script: string, numKeys: number, ...rest: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttl: number, condition?: 'NX'): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ttl: number): Promise<number>;
  pttl(key: string): Promise<number>;
  ping(): Promise<string>;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
};

const redis = new Redis(process.env.INTEGRATION_REDIS_URL || 'redis://127.0.0.1:6379/15');

function session(jti: string, issuedAt: number): RefreshSession {
  return {
    jti,
    userId: 't321-user',
    familyId: 't321-family',
    expiresAt: Date.now() + 60_000,
    issuedAt,
    status: 'active',
  };
}

describe('真实 Redis 会话索引', () => {
  afterAll(async () => {
    const keys = await redis.keys('refresh:*t321*');
    const userKeys = await redis.keys('refresh:user:t321-user');
    const fence = await redis.keys('refresh:fence:t321-user');
    const all = [...keys, ...userKeys, ...fence, 'refresh:jti:t321-a', 'refresh:jti:t321-b', 'refresh:rotated:t321-a'];
    if (all.length > 0) await redis.del(...all);
    await redis.quit();
  });

  it('并行写入不丢索引，撤销后旧血统不能写回', async () => {
    const store = new RedisRefreshSessionStore(redis);
    await Promise.all([
      store.save(session('t321-a', Date.now())),
      store.save(session('t321-b', Date.now())),
    ]);
    expect(await store.get('t321-a')).toBeTruthy();
    expect(await store.get('t321-b')).toBeTruthy();

    const issuedAt = 1_000;
    await store.save(session('t321-old', issuedAt));
    await store.revokeUser('t321-user');
    await expect(store.save(session('t321-resurrect', issuedAt))).rejects.toThrow(/SESSION_REVOKED/);
    expect(await store.get('t321-a')).toBeUndefined();
    expect(await store.get('t321-resurrect')).toBeUndefined();
  });
});
