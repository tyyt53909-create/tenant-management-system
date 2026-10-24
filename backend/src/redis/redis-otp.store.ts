import type { OtpRecord, OtpStore } from '../modules/auth/otp-store.js';
import type { RedisCommandClient } from './redis.client.js';

export class RedisOtpStore implements OtpStore {
  constructor(
    private readonly redis: RedisCommandClient,
    private readonly prefix = 'otp:',
    private readonly failurePrefix = 'otp:fail:',
  ) {}

  async get(email: string): Promise<OtpRecord | undefined> {
    const raw = await this.redis.get(this.key(email));
    if (!raw) return undefined;
    const record = JSON.parse(raw) as OtpRecord;
    if (Date.now() > record.expiresAt) {
      await this.delete(email);
      return undefined;
    }
    return record;
  }

  async set(email: string, record: OtpRecord): Promise<void> {
    const ttl = Math.max(record.expiresAt - Date.now(), 1000);
    await this.redis.set(this.key(email), JSON.stringify(record), 'PX', ttl);
  }

  async delete(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }

  async incrementFailedAttempts(email: string, ttlMs: number): Promise<number> {
    const key = this.failureKey(email);
    // INCR 是单命令原子操作；失败次数不写回记录 JSON，避免并发读改写丢计数。
    const count = await this.redis.incr(key);
    await this.redis.pexpire(key, Math.max(ttlMs, 1_000));
    return count;
  }

  async getFailedAttempts(email: string): Promise<number> {
    const raw = await this.redis.get(this.failureKey(email));
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  async resetFailedAttempts(email: string): Promise<void> {
    await this.redis.del(this.failureKey(email));
  }

  private key(email: string): string {
    return `${this.prefix}${email}`;
  }

  private failureKey(email: string): string {
    return `${this.failurePrefix}${email}`;
  }
}
