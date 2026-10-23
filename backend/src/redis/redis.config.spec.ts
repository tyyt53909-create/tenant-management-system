import { describe, expect, it } from 'vitest';
import {
  MAX_RECONNECT_DELAY_MS,
  describeRedisConnection,
  redisRetryDelay,
  resolveRedisConnection,
} from './redis.config.js';

function reader(values: Record<string, string>) {
  return (key: string) => values[key];
}

describe('resolveRedisConnection', () => {
  it('优先解析 REDIS_URL，并解码密码', () => {
    const connection = resolveRedisConnection(
      reader({ REDIS_URL: 'redis://:p%40ss@redis.internal:6380/2' }),
    );

    expect(connection).toEqual({
      host: 'redis.internal',
      port: 6380,
      username: undefined,
      password: 'p@ss',
      db: 2,
    });
    expect(describeRedisConnection(connection)).toBe('redis.internal:6380/2');
  });

  it('支持 rediss:// 并开启 TLS 标记', () => {
    const connection = resolveRedisConnection(reader({ REDIS_URL: 'rediss://redis:6379/1' }));
    expect(connection.tls).toEqual({});
    expect(connection.db).toBe(1);
  });

  it('未设置 REDIS_URL 时回退 HOST/PORT/PASSWORD/DB', () => {
    const connection = resolveRedisConnection(
      reader({ REDIS_HOST: 'cache', REDIS_PORT: '6380', REDIS_PASSWORD: 'secret', REDIS_DB: '3' }),
    );

    expect(connection).toEqual({ host: 'cache', port: 6380, password: 'secret', db: 3 });
  });

  it('无配置时使用安全默认值，且不输出密码', () => {
    const connection = resolveRedisConnection(reader({}));
    expect(connection).toEqual({ host: 'localhost', port: 6379, db: 0 });
    expect(describeRedisConnection(connection)).not.toContain('password');
  });

  it('非法 URL 直接抛错', () => {
    expect(() => resolveRedisConnection(reader({ REDIS_URL: 'http://redis' }))).toThrow(/REDIS_URL/);
  });
});

describe('redisRetryDelay', () => {
  it('按 200ms 递增并封顶 5 秒', () => {
    expect(redisRetryDelay(1)).toBe(200);
    expect(redisRetryDelay(10)).toBe(2000);
    expect(redisRetryDelay(100)).toBe(MAX_RECONNECT_DELAY_MS);
  });
});
