import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EmailOtpService } from './email-otp.service.js';
import { BadRequestException } from '@nestjs/common';

describe('EmailOtpService', () => {
  let service: EmailOtpService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService({});
    service = new EmailOtpService(configService);
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
    // 注入已知 code 到 otpStore
    const store = (service as any).otpStore;
    store.set('tenant@example.com', {
      code: '889900',
      expiresAt: Date.now() + 5 * 60 * 1000,
      lastSentAt: Date.now(),
    });

    // 错误验证码
    expect(service.verifyCode('tenant@example.com', '000000')).toBe(false);

    // 正确验证码
    expect(service.verifyCode('tenant@example.com', '889900')).toBe(true);

    // 再次使用应已失效
    expect(service.verifyCode('tenant@example.com', '889900')).toBe(false);
  });

  it('过期验证码应返回 false', () => {
    const store = (service as any).otpStore;
    store.set('tenant@example.com', {
      code: '889900',
      expiresAt: Date.now() - 1000,
      lastSentAt: Date.now() - 2000,
    });

    expect(service.verifyCode('tenant@example.com', '889900')).toBe(false);
  });

  it('非生产环境下支持万能验证码 123456', () => {
    expect(service.verifyCode('anyuser@example.com', '123456')).toBe(true);
  });
});
