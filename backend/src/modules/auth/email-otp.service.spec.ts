import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger, BadRequestException } from '@nestjs/common';
import { EmailOtpService } from './email-otp.service.js';
import { OTP_MAX_FAILED_ATTEMPTS, type OtpStore } from './otp-store.js';

function storeOf(service: EmailOtpService): OtpStore {
  return (service as unknown as { otpStore: OtpStore }).otpStore;
}

function pinCode(service: EmailOtpService, code: string): void {
  vi.spyOn(service as unknown as { generateCode: () => string }, 'generateCode').mockReturnValue(code);
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

  it('存储记录不含明文验证码，只保存哈希与盐', async () => {
    pinCode(service, '889900');
    await service.sendCode('tenant@example.com');

    const record = await storeOf(service).get('tenant@example.com');
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty('code');
    expect(record?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(record)).not.toContain('889900');
  });

  it('同一验证码两次发送使用不同盐，摘要不同', async () => {
    pinCode(service, '889900');
    await service.sendCode('tenant@example.com');
    const first = await storeOf(service).get('tenant@example.com');

    // 绕过 60 秒冷却，模拟重发
    if (first) {
      await storeOf(service).set('tenant@example.com', { ...first, lastSentAt: Date.now() - 61_000 });
    }
    await service.sendCode('tenant@example.com');
    const second = await storeOf(service).get('tenant@example.com');

    expect(second?.salt).not.toBe(first?.salt);
    expect(second?.codeHash).not.toBe(first?.codeHash);
  });

  it('在 60 秒冷却期内重复请求应抛出 BadRequestException', async () => {
    await service.sendCode('tenant@example.com');
    await expect(service.sendCode('tenant@example.com')).rejects.toThrow(BadRequestException);
  });

  it('验证码正确能够通过校验并单次失效', async () => {
    pinCode(service, '889900');
    await service.sendCode('tenant@example.com');

    expect(await service.verifyCode('tenant@example.com', '000000')).toBe(false);
    expect(await service.verifyCode('tenant@example.com', '889900')).toBe(true);
    expect(await service.verifyCode('tenant@example.com', '889900')).toBe(false);
  });

  it('升级前的明文记录（无 codeHash/salt）被拒绝并删除', async () => {
    const email = 'tenant@example.com';
    await storeOf(service).set(email, {
      code: '889900',
      expiresAt: Date.now() + 60_000,
      lastSentAt: Date.now(),
      failedAttempts: 0,
    } as never);

    expect(await service.verifyCode(email, '889900')).toBe(false);
    expect(await storeOf(service).get(email)).toBeUndefined();
  });

  it('过期验证码应返回 false', async () => {
    pinCode(service, '889900');
    await service.sendCode('tenant@example.com');
    const record = await storeOf(service).get('tenant@example.com');
    await storeOf(service).set('tenant@example.com', {
      ...record!,
      expiresAt: Date.now() - 1000,
      lastSentAt: Date.now() - 2000,
    });

    expect(await service.verifyCode('tenant@example.com', '889900')).toBe(false);
  });

  it('NODE_ENV 未设置时，万能码 123456 验证失败', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBypass = process.env.OTP_DEV_BYPASS;
    delete process.env.NODE_ENV;
    delete process.env.OTP_DEV_BYPASS;
    const isolated = new EmailOtpService(new ConfigService({}));

    expect(await isolated.verifyCode('anyuser@example.com', '123456')).toBe(false);

    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('OTP_DEV_BYPASS', previousBypass);
  });

  it('NODE_ENV 不是 development 时，即使打开 OTP_DEV_BYPASS，万能码也失败', async () => {
    const isolated = new EmailOtpService(
      new ConfigService({ NODE_ENV: 'production', OTP_DEV_BYPASS: 'true' }),
    );

    expect(await isolated.verifyCode('anyuser@example.com', '123456')).toBe(false);
  });

  it('NODE_ENV=development 但未打开 OTP_DEV_BYPASS 时，万能码失败', async () => {
    const isolated = new EmailOtpService(
      new ConfigService({ NODE_ENV: 'development', OTP_DEV_BYPASS: 'false' }),
    );

    expect(await isolated.verifyCode('anyuser@example.com', '123456')).toBe(false);
  });

  it('仅当 NODE_ENV=development 且 OTP_DEV_BYPASS=true 时，万能码通过', async () => {
    const isolated = new EmailOtpService(
      new ConfigService({ NODE_ENV: 'development', OTP_DEV_BYPASS: 'true' }),
    );

    expect(await isolated.verifyCode('anyuser@example.com', '123456')).toBe(true);
  });

  it('连续 5 次错误后验证码作废，第 6 次即使输入正确码也失败', async () => {
    const email = 'tenant@example.com';
    pinCode(service, '889900');
    await service.sendCode(email);

    for (let attempt = 0; attempt < OTP_MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect(await service.verifyCode(email, '000000')).toBe(false);
    }

    expect(await service.verifyCode(email, '889900')).toBe(false);
    expect(await storeOf(service).get(email)).toBeUndefined();
  });

  it('并发错误输入不会丢计数，达到上限后正确码也失败', async () => {
    const email = 'tenant@example.com';
    pinCode(service, '889900');
    await service.sendCode(email);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.verifyCode(email, '000000')),
    );

    expect(results.every((result) => result === false)).toBe(true);
    // 并发达到阈值后记录与计数器一起作废，后续正确码也不能再用
    expect(await storeOf(service).get(email)).toBeUndefined();
    expect(await service.verifyCode(email, '889900')).toBe(false);
  });

  it('未达 5 次错误时，正确验证码仍然可以通过', async () => {
    const email = 'tenant@example.com';
    pinCode(service, '889900');
    await service.sendCode(email);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await service.verifyCode(email, '000000')).toBe(false);
    }

    expect(await service.verifyCode(email, '889900')).toBe(true);
  });

  it('验证码作废后必须重新发送，新验证码可以通过', async () => {
    const email = 'tenant@example.com';
    pinCode(service, '889900');
    await service.sendCode(email);

    for (let attempt = 0; attempt < OTP_MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect(await service.verifyCode(email, '000000')).toBe(false);
    }
    expect(await service.verifyCode(email, '889900')).toBe(false);

    pinCode(service, '550000');
    await service.sendCode(email);

    expect(await service.verifyCode(email, '550000')).toBe(true);
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
      const isolated = new EmailOtpService(new ConfigService({ NODE_ENV: 'production' }));
      pinCode(isolated, '550000');
      (isolated as unknown as { transporter: { sendMail: () => Promise<never> } }).transporter = {
        sendMail: () => Promise.reject(new Error('smtp down body 550000')),
      };

      await expect(isolated.sendCode('tenant@example.com')).rejects.toThrow(BadRequestException);

      const logged = entries.join('\n');
      expect(logged).not.toContain('550000');
      expect(logged).toContain('[redacted]');
      expect(await isolated.verifyCode('tenant@example.com', '550000')).toBe(false);
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
