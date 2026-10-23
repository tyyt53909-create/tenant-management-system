import { parseRedisUrl } from '../config/env.schema.js';

export const MAX_RECONNECT_DELAY_MS = 5000;

/** 指数退避的简化形式：200ms 递增，封顶 5 秒。 */
export function redisRetryDelay(times: number): number {
  return Math.min(times * 200, MAX_RECONNECT_DELAY_MS);
}

export interface RedisConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls?: Record<string, never>;
}

/**
 * 优先使用 REDIS_URL（支持 rediss:// 与密码），否则回退到 HOST/PORT/PASSWORD/DB。
 * 返回值只用于建立连接，调用方不得把它整体写进日志（含密码）。
 */
export function resolveRedisConnection(
  read: (key: string) => string | undefined,
): RedisConnection {
  const url = (read('REDIS_URL') || '').trim();
  if (url) {
    const parsed = parseRedisUrl(url);
    if (typeof parsed === 'string') {
      throw new Error(`REDIS_URL 不合法：${parsed}`);
    }
    return {
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      db: parsed.db,
      ...(parsed.tls ? { tls: {} } : {}),
    };
  }

  const host = (read('REDIS_HOST') || 'localhost').trim();
  const port = Number(read('REDIS_PORT') || '6379');
  const db = Number(read('REDIS_DB') || '0');
  const password = (read('REDIS_PASSWORD') || '').trim();
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : 6379,
    db: Number.isInteger(db) && db >= 0 ? db : 0,
    ...(password ? { password } : {}),
  };
}

/** 可安全写日志的目标描述：只含 host、port、db。 */
export function describeRedisConnection(connection: RedisConnection): string {
  return `${connection.host}:${connection.port}/${connection.db}`;
}
