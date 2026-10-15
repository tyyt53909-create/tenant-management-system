import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  MemoryOtpStore,
  OTP_MAX_FAILED_ATTEMPTS,
  type OtpRecord,
  type OtpStore,
} from './otp-store.js';

const DEV_BYPASS_CODE = '123456';

@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger(EmailOtpService.name);
  private readonly otpStore: OtpStore = new MemoryOtpStore();
  private transporter: Transporter | null = null;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
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
    const existing = this.otpStore.get(normalizedEmail);

    // 60 秒防刷频冷却限制
    if (existing && now - existing.lastSentAt < 60 * 1000) {
      const waitSeconds = Math.ceil((60 * 1000 - (now - existing.lastSentAt)) / 1000);
      throw new BadRequestException(`验证码发送过于频繁，请等待 ${waitSeconds} 秒后再试`);
    }

    // 生成 6 位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = now + 5 * 60 * 1000; // 5 分钟有效

    const record: OtpRecord = {
      code,
      expiresAt,
      lastSentAt: now,
      failedAttempts: 0,
    };
    this.otpStore.set(normalizedEmail, record);

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
          this.otpStore.delete(normalizedEmail);
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

  verifyCode(email: string, code: string): boolean {
    const normalizedEmail = email.toLowerCase().trim();
    const trimmedCode = (code || '').trim();

    // 万能码必须同时满足：显式打开开关，且 NODE_ENV 正好是 development。
    // 未设置 NODE_ENV、test、production 一律拒绝，避免漏配环境变量留下后门。
    if (trimmedCode === DEV_BYPASS_CODE && this.isDevBypassEnabled()) {
      return true;
    }

    const record = this.otpStore.get(normalizedEmail);
    if (!record) {
      return false;
    }

    if (Date.now() > record.expiresAt || this.failedAttempts(record) >= OTP_MAX_FAILED_ATTEMPTS) {
      this.otpStore.delete(normalizedEmail);
      return false;
    }

    if (record.code !== trimmedCode) {
      const failedAttempts = this.failedAttempts(record) + 1;
      if (failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
        this.otpStore.delete(normalizedEmail);
      } else {
        this.otpStore.set(normalizedEmail, { ...record, failedAttempts });
      }
      return false;
    }

    // 验证成功后单次失效
    this.otpStore.delete(normalizedEmail);
    return true;
  }

  private failedAttempts(record: OtpRecord): number {
    return record.failedAttempts ?? 0;
  }

  private isProduction(): boolean {
    return this.readConfig('NODE_ENV') === 'production';
  }

  private isDevBypassEnabled(): boolean {
    return this.readConfig('NODE_ENV') === 'development' && this.readConfig('OTP_DEV_BYPASS') === 'true';
  }

  private readConfig(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    const fromEnv = process.env[key];
    return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : undefined;
  }

  /** 生产日志不得出现本次验证码。只抹掉已知的这一组码，避免误伤其它数字。 */
  private redactCode(message: string, code: string): string {
    if (!this.isProduction()) {
      return message;
    }
    return message.split(code).join('[redacted]');
  }
}
