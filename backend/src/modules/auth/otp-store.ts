/**
 * 验证码存储。记录只保存 HMAC 摘要与盐，不落明文验证码（ISS-10）。
 * 失败次数使用独立的原子计数器，避免「读-改-写」在并发下丢计数。
 */
export interface OtpRecord {
  /** HMAC-SHA256(key, salt + ':' + code)。 */
  codeHash: string;
  /** 每条记录独立的随机盐（hex）。 */
  salt: string;
  expiresAt: number;
  lastSentAt: number;
}

export interface OtpStore {
  get(email: string): Promise<OtpRecord | undefined>;
  set(email: string, record: OtpRecord): Promise<void>;
  delete(email: string): Promise<void>;
  /** 原子自增失败次数并返回累加后的值。 */
  incrementFailedAttempts(email: string, ttlMs: number): Promise<number>;
  getFailedAttempts(email: string): Promise<number>;
  resetFailedAttempts(email: string): Promise<void>;
}

interface FailureCounter {
  count: number;
  expiresAt: number;
}

export class MemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, OtpRecord>();
  private readonly failures = new Map<string, FailureCounter>();

  async get(email: string): Promise<OtpRecord | undefined> {
    return this.records.get(email);
  }

  async set(email: string, record: OtpRecord): Promise<void> {
    this.records.set(email, record);
  }

  async delete(email: string): Promise<void> {
    this.records.delete(email);
  }

  async incrementFailedAttempts(email: string, ttlMs: number): Promise<number> {
    const now = Date.now();
    const current = this.failures.get(email);
    const count = current && current.expiresAt > now ? current.count + 1 : 1;
    this.failures.set(email, { count, expiresAt: now + ttlMs });
    return count;
  }

  async getFailedAttempts(email: string): Promise<number> {
    const current = this.failures.get(email);
    if (!current) return 0;
    if (current.expiresAt <= Date.now()) {
      this.failures.delete(email);
      return 0;
    }
    return current.count;
  }

  async resetFailedAttempts(email: string): Promise<void> {
    this.failures.delete(email);
  }
}

/** 同一组验证码最多允许的错误次数，超过后必须重新发送。 */
export const OTP_MAX_FAILED_ATTEMPTS = 5;

export const OTP_STORE = Symbol('OTP_STORE');
