import type { OtpRecord, OtpStore } from '../modules/auth/otp-store.js';
import type { RedisCommandClient } from './redis.client.js';

export class RedisOtpStore implements OtpStore {
  constructor(
    private readonly redis: RedisCommandClient,
    private readonly prefix = 'otp:',
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

  private key(email: string): string {
    return `${this.prefix}${email}`;
  }
}
