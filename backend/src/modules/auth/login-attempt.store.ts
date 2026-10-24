import { createHash } from 'node:crypto';

/**
 * 登录失败计数存储。identifier 先做规范化与 SHA-256，Redis 键里不出现邮箱/手机号明文。
 *
 * 计数是「滑动窗口 + 锁定」共用一份：每次失败原子自增并刷新 TTL；
 * 达到阈值后不再自增，直接按剩余 TTL 返回 429。
 */
export interface LoginAttemptStore {
  getFailures(identifier: string): Promise<number>;
  /** 原子自增并返回累加后的次数。 */
  registerFailure(identifier: string, ttlMs: number): Promise<number>;
  clear(identifier: string): Promise<void>;
}

export const LOGIN_ATTEMPT_STORE = Symbol('LOGIN_ATTEMPT_STORE');

export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function loginAttemptKey(identifier: string): string {
  return createHash('sha256').update(normalizeLoginIdentifier(identifier)).digest('hex');
}

interface FailureRecord {
  count: number;
  expiresAt: number;
}

export class MemoryLoginAttemptStore implements LoginAttemptStore {
  private readonly records = new Map<string, FailureRecord>();

  async getFailures(identifier: string): Promise<number> {
    const key = loginAttemptKey(identifier);
    const record = this.records.get(key);
    if (!record) return 0;
    if (record.expiresAt <= Date.now()) {
      this.records.delete(key);
      return 0;
    }
    return record.count;
  }

  async registerFailure(identifier: string, ttlMs: number): Promise<number> {
    const key = loginAttemptKey(identifier);
    const now = Date.now();
    const current = this.records.get(key);
    const count = current && current.expiresAt > now ? current.count + 1 : 1;
    this.records.set(key, { count, expiresAt: now + ttlMs });
    return count;
  }

  async clear(identifier: string): Promise<void> {
    this.records.delete(loginAttemptKey(identifier));
  }
}
