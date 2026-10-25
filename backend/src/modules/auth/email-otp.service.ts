import { Inject, Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { randomOtpCode } from '../../common/utils/secure-random.js';
import {
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_STORE,
  type OtpRecord,
  type OtpStore,
} from './otp-store.js';

const DEV_BYPASS_CODE = '123456';
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_SEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);
  private readonly hashSecret: Buffer;
  private transporter: Transporter | null = null;
  private readonly fromAddress: string;

  /**
   * `OTP_STORE` 必填（QLT-02 / T288）。
   * 之前 `?? new MemoryOtpStore()` 会在 AuthModule 工厂漏注册时静默退化成进程内存：
   * 多实例下「A 发的验证码 B 验证不了」，而日志里看不出来。
   * 存储实现选择（Redis / 内存）由 AuthModule 统一决定。
   */
  constructor(
    private readonly configService: ConfigService,
    @Inject(OTP_STORE) private readonly otpStore: OtpStore,
  ) {
    this.hashSecret = this.resolveHashSecret();
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT') || 465;
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    this.fromAddress = this.configService.get<string>('SMTP_FROM') || '"栖居生活" <no-reply@qiju.com>';

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`SMTP 邮件服务已就绪: ${host}:${port}`);
    } else if (this.isProduction()) {
      this.logger.error('生产环境未配置 SMTP，邮箱验证码发送已禁用');
    } else {
      this.logger.log('未配置 SMTP 凭据，验证码将在开发模式控制台打印输出');
    }
  }

  async sendCode(email: string): Promise<{ cooldown: number }> {
    const normalizedEmail = email.toLowerCase().trim();

    if (!this.transporter && this.isProduction()) {
      this.logger.error(`生产环境未配置 SMTP，已拒绝向 ${normalizedEmail} 发送验证码`);
      throw new BadRequestException('邮件服务未配置，无法发送验证码');
    }

    const now = Date.now();
    const existing = await this.otpStore.get(normalizedEmail);

    // 60 秒防刷频冷却限制
    if (existing && now - existing.lastSentAt < OTP_SEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((OTP_SEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);
      throw new BadRequestException(`验证码发送过于频繁，请等待 ${waitSeconds} 秒后再试`);
    }

    const code = this.generateCode();
    const salt = randomBytes(16).toString('hex');
    const record: OtpRecord = {
      codeHash: this.hashCode(code, salt),
      salt,
      expiresAt: now + OTP_TTL_MS,
      lastSentAt: now,
    };

    // 新验证码开始新的失败计数窗口。
    await this.otpStore.resetFailedAttempts(normalizedEmail);
    await this.otpStore.set(normalizedEmail, record);

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.fromAddress,
          to: normalizedEmail,
          subject: '【栖居】您的登录验证码',
          html: `
            <div style="padding: 24px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f2ec; color: #302f2a; border-radius: 12px; max-width: 500px; margin: 0 auto;">
              <h2 style="color: #68715b; margin-top: 0;">栖居 · 租客生活服务</h2>
              <p style="font-size: 15px; line-height: 1.6;">您好，您正在登录或认证栖居系统，您的验证码为：</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4e5845; padding: 16px 0; text-align: center; background: #fffefa; border-radius: 8px; margin: 16px 0;">
                ${code}
              </div>
              <p style="font-size: 13px; color: #817e76;">该验证码 5 分钟内有效。如非本人操作，请忽略此邮件。</p>
            </div>
          `,
        });
        this.logger.log(`验证码邮件已成功投递至: ${normalizedEmail}`);
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'unknown';
        if (this.isProduction()) {
          await this.otpStore.delete(normalizedEmail);
          await this.otpStore.resetFailedAttempts(normalizedEmail);
          this.logger.error(this.redactCode(`邮件投递失败，已作废本次验证码: ${reason}`, code));
          throw new BadRequestException('验证码邮件发送失败，请稍后重试');
        }
        this.logger.error(`邮件投递失败: ${reason}`);
        this.logger.warn(`[DEV FALLBACK] 验证码为: ${code}`);
      }
    } else {
      this.logger.warn(`[DEV OTP] 📧 验证码已发送至 ${normalizedEmail}: [ ${code} ]（5分钟内有效）`);
    }

    return { cooldown: 60 };
  }

  async verifyCode(email: string, code: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();
    const trimmedCode = (code || '').trim();

    // 万能码必须同时满足：显式打开开关，且 NODE_ENV 正好是 development。
    // 未设置 NODE_ENV、test、production 一律拒绝，避免漏配环境变量留下后门。
    if (trimmedCode === DEV_BYPASS_CODE && this.isDevBypassEnabled()) {
      return true;
    }

    const record = await this.otpStore.get(normalizedEmail);
    if (!record) {
      return false;
    }

    // 兼容滚动升级：旧版记录只有明文 code、没有 codeHash/salt，一律作废重发。
    if (typeof record.codeHash !== 'string' || typeof record.salt !== 'string') {
      await this.invalidate(normalizedEmail);
      return false;
    }

    if (Date.now() > record.expiresAt) {
      await this.invalidate(normalizedEmail);
      return false;
    }

    // 计数达到上限时整条记录作废，避免继续爆破。
    if ((await this.otpStore.getFailedAttempts(normalizedEmail)) >= OTP_MAX_FAILED_ATTEMPTS) {
      await this.invalidate(normalizedEmail);
      return false;
    }

    if (!this.matchesCode(record, trimmedCode)) {
      const ttlMs = Math.max(record.expiresAt - Date.now(), 1_000);
      const failedAttempts = await this.otpStore.incrementFailedAttempts(normalizedEmail, ttlMs);
      if (failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
        await this.invalidate(normalizedEmail);
      }
      return false;
    }

    // 验证成功后单次失效
    await this.invalidate(normalizedEmail);
    return true;
  }

  /** 独立方法便于测试注入固定验证码；生产实现使用密码学安全随机源。 */
  protected generateCode(): string {
    return randomOtpCode();
  }

  private matchesCode(record: OtpRecord, code: string): boolean {
    const expected = Buffer.from(record.codeHash, 'hex');
    const actual = Buffer.from(this.hashCode(code, record.salt), 'hex');
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }

  private hashCode(code: string, salt: string): string {
    return createHmac('sha256', this.hashSecret).update(`${salt}:${code}`).digest('hex');
  }

  private async invalidate(email: string): Promise<void> {
    await this.otpStore.delete(email);
    await this.otpStore.resetFailedAttempts(email);
  }

  /**
   * 优先使用 OTP_HASH_SECRET；未配置时回退 JWT_SECRET（生产必填，多实例一致）。
   * 开发/测试两者都没有时使用进程内随机密钥，只影响该进程内的验证码。
   */
  private resolveHashSecret(): Buffer {
    const configured =
      this.readConfig('OTP_HASH_SECRET') ??
      this.readConfig('jwt.secret') ??
      this.readConfig('JWT_SECRET');
    if (configured) {
      return Buffer.from(configured, 'utf8');
    }
    if (this.isProduction()) {
      this.logger.error('生产环境缺少 OTP_HASH_SECRET 与 JWT_SECRET，验证码哈希使用进程内随机密钥');
    } else {
      this.logger.warn('未配置 OTP_HASH_SECRET/JWT_SECRET，验证码哈希使用进程内随机密钥（重启后验证码失效）');
    }
    return randomBytes(32);
  }

  private isProduction(): boolean {
    return this.readConfig('NODE_ENV') === 'production';
  }

  private isDevBypassEnabled(): boolean {
    return this.readConfig('NODE_ENV') === 'development' && this.readConfig('OTP_DEV_BYPASS') === 'true';
  }

  private readConfig(key: string): string | undefined {
    // ConfigService 本身会回退到 process.env，这里不必再手写兜底
    const value = this.configService.get<string>(key);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /** 生产日志不得出现本次验证码。只抹掉已知的这一组码，避免误伤其它数字。 */
  private redactCode(message: string, code: string): string {
    if (!this.isProduction()) {
      return message;
    }
    return message.split(code).join('[redacted]');
  }
}
