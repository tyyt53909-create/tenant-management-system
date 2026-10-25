import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { SmsOtpService } from './sms-otp.service.js';
import { MemoryOtpStore } from './otp-store.js';
import { SmsService } from '../sms/sms.service.js';

describe('SmsOtpService', () => {
  let service: SmsOtpService;
  let otpStore: MemoryOtpStore;
  let smsService: any;
  let configService: ConfigService;

  beforeEach(() => {
    otpStore = new MemoryOtpStore();
    smsService = {
      sendOtp: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'mock-sms-id',
      }),
    };
    configService = new ConfigService({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-at-least-32-chars-long-abc',
      OTP_DEV_BYPASS: 'true',
    });
    service = new SmsOtpService(configService, otpStore, smsService as SmsService);
  });

  it('非法国内手机号发送时抛出 BadRequestException', async () => {
    await expect(service.sendCode('12345')).rejects.toThrow(BadRequestException);
    await expect(service.sendCode('abcdefghijk')).rejects.toThrow(BadRequestException);
    await expect(service.sendCode('23812345678')).rejects.toThrow(BadRequestException);
  });

  it('合法手机号发送验证码并记录 cooldown', async () => {
    const res = await service.sendCode('13812345678');
    expect(res.cooldown).toBe(60);
    expect(smsService.sendOtp).toHaveBeenCalledWith('13812345678', expect.any(String));

    const record = await otpStore.get('sms:13812345678');
    expect(record).toBeDefined();
    expect(record?.codeHash).toBeTypeOf('string');
    expect(record?.salt).toBeTypeOf('string');
  });

  it('60 秒防刷冷却：连续发送抛出异常', async () => {
    await service.sendCode('13812345678');
    await expect(service.sendCode('13812345678')).rejects.toThrow(/过于频繁/);
  });

  it('使用 seedCodeForTests 注入验证码并成功校验', async () => {
    await service.seedCodeForTests('13812345678', '654321');

    const invalid = await service.verifyCode('13812345678', '000000');
    expect(invalid).toBe(false);

    const valid = await service.verifyCode('13812345678', '654321');
    expect(valid).toBe(true);

    // 验证成功后已作废，二次校验应失败
    const reused = await service.verifyCode('13812345678', '654321');
    expect(reused).toBe(false);
  });

  it('连续错误超过 5 次自动熔断销毁验证码', async () => {
    await service.seedCodeForTests('13812345678', '999999');

    for (let i = 0; i < 5; i += 1) {
      const ok = await service.verifyCode('13812345678', `00000${i}`);
      expect(ok).toBe(false);
    }

    // 第 6 次触发超过限制并彻底销毁
    const sixth = await service.verifyCode('13812345678', '999999');
    expect(sixth).toBe(false);

    const record = await otpStore.get('sms:13812345678');
    expect(record).toBeUndefined();
  });

  it('过期验证码校验返回 false', async () => {
    await service.seedCodeForTests('13812345678', '111222');
    const record = (await otpStore.get('sms:13812345678'))!;
    record.expiresAt = Date.now() - 1000;
    await otpStore.set('sms:13812345678', record);

    const res = await service.verifyCode('13812345678', '111222');
    expect(res).toBe(false);
  });

  it('开发环境且开启 OTP_DEV_BYPASS 时支持万能码 123456', async () => {
    const devConfig = new ConfigService({
      NODE_ENV: 'development',
      OTP_DEV_BYPASS: 'true',
      JWT_SECRET: 'test-secret-at-least-32-chars-long-abc',
    });
    const devService = new SmsOtpService(devConfig, otpStore, smsService as SmsService);

    expect(await devService.verifyCode('13812345678', '123456')).toBe(true);
  });
});
