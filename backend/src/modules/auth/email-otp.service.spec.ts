import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger, BadRequestException } from '@nestjs/common';
import { EmailOtpService } from './email-otp.service.js';
import type { OtpStore } from './otp-store.js';

function storeOf(service: EmailOtpService): OtpStore {
  return (service as unknown as { otpStore: OtpStore }).otpStore;
}

describe('EmailOtpService', () => {
  let service: EmailOtpService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService({});
    service = new EmailOtpService(configService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('能够成功生成并发送验证码', async () => {
    const res = await service.sendCode('tenant@example.com');
    expect(res.cooldown).toBe(60);
  });

  it('在 60 秒冷却期内重复请求应抛出 BadRequestException', async () => {
    await service.sendCode('tenant@example.com');
    await expect(service.sendCode('tenant@example.com')).rejects.toThrow(BadRequestException);
  });

  it('验证码正确能够通过校验并单次失效', async () => {
    storeOf(service).set('tenant@example.com', {
      code: '889900',
      expiresAt: Date.now() + 5 * 60 * 1000,
      lastSentAt: Date.now(),
      failedAttempts: 0,
    });

    expect(service.verifyCode('tenant@example.com', '000000')).toBe(false);
    expect(service.verifyCode('tenant@example.com', '889900')).toBe(true);
    expect(service.verifyCode('tenant@example.com', '889900')).toBe(false);
  });

  it('过期验证码应返回 false', () => {
    storeOf(service).set('tenant@example.com', {
      code: '889900',
      expiresAt: Date.now() - 1000,
      lastSentAt: Date.now() - 2000,
      failedAttempts: 0,
    });

    expect(service.verifyCode('tenant@example.com', '889900')).toBe(false);
  });

  it('NODE_ENV 未设置时，万能码 123456 验证失败', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBypass = process.env.OTP_DEV_BYPASS;
    delete process.env.NODE_ENV;
    delete process.env.OTP_DEV_BYPASS;
    const isolated = new EmailOtpService(new ConfigService({}));

    expect(isolated.verifyCode('anyuser@example.com', '123456')).toBe(false);

    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('OTP_DEV_BYPASS', previousBypass);
  });

  it('NODE_ENV 不是 development 时，即使打开 OTP_DEV_BYPASS，万能码也失败', () => {
    const isolated = new EmailOtpService(
      new ConfigService({ NODE_ENV: 'production', OTP_DEV_BYPASS: 'true' }),
    );

    expect(isolated.verifyCode('anyuser@example.com', '123456')).toBe(false);
  });

  it('NODE_ENV=development 但未打开 OTP_DEV_BYPASS 时，万能码失败', () => {
    const isolated = new EmailOtpService(
      new ConfigService({ NODE_ENV: 'development', OTP_DEV_BYPASS: 'false' }),
    );

    expect(isolated.verifyCode('anyuser@example.com', '123456')).toBe(false);
  });

  it('仅当 NODE_ENV=development 且 OTP_DEV_BYPASS=true 时，万能码通过', () => {
    const isolated = new EmailOtpService(
      new ConfigService({ NODE_ENV: 'development', OTP_DEV_BYPASS: 'true' }),
    );

    expect(isolated.verifyCode('anyuser@example.com', '123456')).toBe(true);
  });

  it('连续 5 次错误后验证码作废，第 6 次即使输入正确码也失败', () => {
    const email = 'tenant@example.com';
    storeOf(service).set(email, {
      code: '889900',
      expiresAt: Date.now() + 5 * 60 * 1000,
      lastSentAt: Date.now(),
      failedAttempts: 0,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(service.verifyCode(email, '000000')).toBe(false);
    }

    expect(service.verifyCode(email, '889900')).toBe(false);
    expect(storeOf(service).get(email)).toBeUndefined();
  });

  it('未达 5 次错误时，正确验证码仍然可以通过', () => {
    const email = 'tenant@example.com';
    storeOf(service).set(email, {
      code: '889900',
      expiresAt: Date.now() + 5 * 60 * 1000,
      lastSentAt: Date.now(),
      failedAttempts: 0,
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(service.verifyCode(email, '000000')).toBe(false);
    }

    expect(service.verifyCode(email, '889900')).toBe(true);
  });

  it('验证码作废后必须重新发送，新验证码可以通过', async () => {
    const email = 'tenant@example.com';
    storeOf(service).set(email, {
      code: '889900',
      expiresAt: Date.now() + 5 * 60 * 1000,
      lastSentAt: Date.now() - 61_000,
      failedAttempts: 4,
    });
    expect(service.verifyCode(email, '000000')).toBe(false);
    expect(service.verifyCode(email, '889900')).toBe(false);

    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await service.sendCode(email);

    expect(service.verifyCode(email, '550000')).toBe(true);
  });

  describe('生产环境日志', () => {
    const spies: Array<ReturnType<typeof vi.spyOn>> = [];

    afterEach(() => {
      for (const spy of spies) spy.mockRestore();
      spies.length = 0;
    });

    function captureLogs() {
      const entries: string[] = [];
      for (const level of ['log', 'warn', 'error'] as const) {
        spies.push(
          vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
            entries.push(args.map(String).join(' '));
          }),
        );
      }
      return entries;
    }

    it('未配置 SMTP 时拒绝发送，且日志中没有 6 位验证码', async () => {
      const entries = captureLogs();
      const isolated = new EmailOtpService(new ConfigService({ NODE_ENV: 'production' }));

      await expect(isolated.sendCode('tenant@example.com')).rejects.toThrow(BadRequestException);
      expect(entries.join('\n')).not.toMatch(/\b\d{6}\b/);
    });

    it('发信失败时日志搜不到本次验证码，且该验证码不能再使用', async () => {
      const entries = captureLogs();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const isolated = new EmailOtpService(new ConfigService({ NODE_ENV: 'production' }));
      (isolated as unknown as { transporter: { sendMail: () => Promise<never> } }).transporter = {
        sendMail: () => Promise.reject(new Error('smtp down body 550000')),
      };

      await expect(isolated.sendCode('tenant@example.com')).rejects.toThrow(BadRequestException);

      const logged = entries.join('\n');
      expect(logged).not.toContain('550000');
      expect(logged).toContain('[redacted]');
      expect(isolated.verifyCode('tenant@example.com', '550000')).toBe(false);
    });
  });
});

function restoreEnv(key: 'NODE_ENV' | 'OTP_DEV_BYPASS', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
