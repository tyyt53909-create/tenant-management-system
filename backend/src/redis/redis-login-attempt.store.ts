import type { LoginAttemptStore } from '../modules/auth/login-attempt.store.js';
import { loginAttemptKey } from '../modules/auth/login-attempt.store.js';
import type { RedisCommandClient } from './redis.client.js';

export class RedisLoginAttemptStore implements LoginAttemptStore {
  constructor(
    private readonly redis: RedisCommandClient,
    private readonly prefix = 'login:fail:',
  ) {}

  async getFailures(identifier: string): Promise<number> {
    const raw = await this.redis.get(this.key(identifier));
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  async registerFailure(identifier: string, ttlMs: number): Promise<number> {
    const key = this.key(identifier);
    // INCR 是单命令原子操作；每次都 PEXPIRE 让窗口随失败滑动，同时避免 INCR 后进程退出导致键永不过期。
    const count = await this.redis.incr(key);
    await this.redis.pexpire(key, Math.max(ttlMs, 1_000));
    return count;
  }

  async clear(identifier: string): Promise<void> {
    await this.redis.del(this.key(identifier));
  }

  private key(identifier: string): string {
    return `${this.prefix}${loginAttemptKey(identifier)}`;
  }
}
