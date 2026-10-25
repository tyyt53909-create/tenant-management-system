import { Inject, Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomOtpCode } from '../../common/utils/secure-random.js';
import {
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_STORE,
  type OtpRecord,
  type OtpStore,
} from './otp-store.js';
import { SmsService } from '../sms/sms.service.js';

const DEV_BYPASS_CODE = '123456';
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_SEND_COOLDOWN_MS = 60 * 1000;
const CHINA_MOBILE_REGEX = /^1[3-9]\d{9}$/;

@Injectable()
export class SmsOtpService {
  private readonly logger = new Logger(SmsOtpService.name);
  private readonly hashSecret: Buffer;

  constructor(
    private readonly configService: ConfigService,
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
    private readonly smsService: SmsService,
  ) {
    this.hashSecret = this.resolveHashSecret();
  }

  /**
   * 发送手机短信验证码
   */
  async sendCode(phone: string): Promise<{ cooldown: number }> {
    const normalizedPhone = this.normalizePhone(phone);
    const storeKey = this.buildStoreKey(normalizedPhone);

    const now = Date.now();
    const existing = await this.otpStore.get(storeKey);

    // 60 秒防刷冷却
    if (existing && now - existing.lastSentAt < OTP_SEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil(
        (OTP_SEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000,
      );
      throw new BadRequestException(`短信发送过于频繁，请等待 ${waitSeconds} 秒后再试`);
    }

    const code = randomOtpCode();
    const salt = randomBytes(16).toString('hex');
    const record: OtpRecord = {
      codeHash: this.hashCode(code, salt),
      salt,
      expiresAt: now + OTP_TTL_MS,
      lastSentAt: now,
    };

    // 新验证码重置失败尝试次数
    await this.otpStore.resetFailedAttempts(storeKey);
    await this.otpStore.set(storeKey, record);

    const result = await this.smsService.sendOtp(normalizedPhone, code);
    if (!result.success) {
      if (this.isProduction()) {
        await this.otpStore.delete(storeKey);
        await this.otpStore.resetFailedAttempts(storeKey);
        this.logger.error(`短信发送失败，作废本次验证码: ${result.message}`);
        throw new BadRequestException('短信验证码发送失败，请稍后重试');
      }
      this.logger.warn(`[DEV SMS OTP FALLBACK] 验证码为: ${code}`);
    }

    return { cooldown: 60 };
  }

  /**
   * 校验手机短信验证码
   */
  async verifyCode(phone: string, code: string): Promise<boolean> {
    const normalizedPhone = this.normalizePhone(phone);
    const trimmedCode = (code || '').trim();

    // 万能码校验（仅在开发模式显式启用时有效）
    if (trimmedCode === DEV_BYPASS_CODE && this.isDevBypassEnabled()) {
      return true;
    }

    const storeKey = this.buildStoreKey(normalizedPhone);
    const record = await this.otpStore.get(storeKey);
    if (!record) {
      return false;
    }

    if (typeof record.codeHash !== 'string' || typeof record.salt !== 'string') {
      await this.invalidate(normalizedPhone);
      return false;
    }

    if (Date.now() > record.expiresAt) {
      await this.invalidate(normalizedPhone);
      return false;
    }

    const attempts = await this.otpStore.incrementFailedAttempts(
      storeKey,
      OTP_TTL_MS,
    );
    if (attempts > OTP_MAX_FAILED_ATTEMPTS) {
      await this.invalidate(normalizedPhone);
      this.logger.warn(`手机号 ${normalizedPhone} 验证码错误超限，已销毁`);
      return false;
    }

    const expectedHash = this.hashCode(trimmedCode, record.salt);
    const matches = timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(record.codeHash, 'hex'),
    );

    if (matches) {
      await this.invalidate(normalizedPhone);
      return true;
    }

    return false;
  }

  /**
   * 测试夹具种入验证码（仅限 NODE_ENV=test）
   */
  async seedCodeForTests(phone: string, code: string): Promise<void> {
    if (this.readConfig('NODE_ENV') !== 'test') {
      throw new Error('seedCodeForTests 只能在 NODE_ENV=test 使用');
    }
    const normalizedPhone = this.normalizePhone(phone);
    const storeKey = this.buildStoreKey(normalizedPhone);
    const salt = randomBytes(16).toString('hex');
    const now = Date.now();
    await this.otpStore.resetFailedAttempts(storeKey);
    await this.otpStore.set(storeKey, {
      codeHash: this.hashCode(code, salt),
      salt,
      expiresAt: now + OTP_TTL_MS,
      lastSentAt: now - OTP_SEND_COOLDOWN_MS,
    });
  }

  private normalizePhone(phone: string): string {
    const trimmed = (phone || '').trim();
    if (!CHINA_MOBILE_REGEX.test(trimmed)) {
      throw new BadRequestException('请输入有效的 11 位国内手机号');
    }
    return trimmed;
  }

  private buildStoreKey(phone: string): string {
    return `sms:${phone}`;
  }

  private async invalidate(phone: string): Promise<void> {
    const storeKey = this.buildStoreKey(phone);
    await this.otpStore.delete(storeKey);
    await this.otpStore.resetFailedAttempts(storeKey);
  }

  private hashCode(code: string, salt: string): string {
    return createHmac('sha256', this.hashSecret)
      .update(`${salt}:${code}`)
      .digest('hex');
  }

  private resolveHashSecret(): Buffer {
    const configured = this.readConfig('OTP_HASH_SECRET')?.trim();
    if (configured) {
      return Buffer.from(configured, 'utf8');
    }
    const fallback = this.readConfig('JWT_SECRET')?.trim();
    if (fallback) {
      return Buffer.from(fallback, 'utf8');
    }
    if (this.isProduction()) {
      throw new Error('生产环境必须配置 OTP_HASH_SECRET 或 JWT_SECRET');
    }
    return Buffer.from('dev-insecure-otp-hash-secret-do-not-use-in-production');
  }

  private isProduction(): boolean {
    return this.readConfig('NODE_ENV') === 'production';
  }

  private isDevBypassEnabled(): boolean {
    const env = this.readConfig('NODE_ENV');
    const bypass = this.readConfig('OTP_DEV_BYPASS');
    return env === 'development' && bypass === 'true';
  }

  private readConfig(key: string): string | undefined {
    return this.configService?.get<string>(key);
  }
}
