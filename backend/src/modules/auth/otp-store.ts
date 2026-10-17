/**
 * 验证码存储。OPT-01 使用进程内实现；OPT-08 再换成 Redis，调用方只依赖此接口。
 */
export interface OtpRecord {
  code: string;
  expiresAt: number;
  lastSentAt: number;
  /** 当前这组验证码已连续输错的次数。达到上限后整条记录作废。 */
  failedAttempts: number;
}

export interface OtpStore {
  get(email: string): Promise<OtpRecord | undefined>;
  set(email: string, record: OtpRecord): Promise<void>;
  delete(email: string): Promise<void>;
}

export class MemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, OtpRecord>();

  async get(email: string): Promise<OtpRecord | undefined> {
    return this.records.get(email);
  }

  async set(email: string, record: OtpRecord): Promise<void> {
    this.records.set(email, record);
  }

  async delete(email: string): Promise<void> {
    this.records.delete(email);
  }
}

/** 同一组验证码最多允许的错误次数，超过后必须重新发送。 */
export const OTP_MAX_FAILED_ATTEMPTS = 5;

export const OTP_STORE = Symbol('OTP_STORE');
