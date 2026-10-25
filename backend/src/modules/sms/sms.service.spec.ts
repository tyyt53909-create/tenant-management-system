import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service.js';
import { MockSmsProvider } from './providers/mock-sms.provider.js';
import { AliyunSmsProvider } from './providers/aliyun-sms.provider.js';

describe('SmsModule & Providers', () => {
  describe('MockSmsProvider', () => {
    let mockProvider: MockSmsProvider;

    beforeEach(() => {
      mockProvider = new MockSmsProvider();
    });

    it('模拟下发短信并存入记录', async () => {
      const res = await mockProvider.send({
        phone: '13800000001',
        templateCode: 'SMS_TEST_01',
        templateParam: { code: '888888' },
      });

      expect(res.success).toBe(true);
      expect(res.code).toBe('OK');
      expect(res.messageId).toContain('mock_sms_');

      const records = mockProvider.getSentRecords();
      expect(records).toHaveLength(1);
      expect(records[0].phone).toBe('13800000001');

      const latest = mockProvider.getLatestRecord('13800000001');
      expect(latest?.templateParam).toEqual({ code: '888888' });

      mockProvider.clear();
      expect(mockProvider.getSentRecords()).toHaveLength(0);
    });
  });

  describe('AliyunSmsProvider', () => {
    it('凭证缺失时返回 MISSING_CREDENTIALS 错误', async () => {
      const provider = new AliyunSmsProvider({
        accessKeyId: '',
        accessKeySecret: '',
      });

      const res = await provider.send({ phone: '13800000001' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('MISSING_CREDENTIALS');
    });

    it('接口返回 OK 时发送成功', async () => {
      const provider = new AliyunSmsProvider({
        accessKeyId: 'test_ak',
        accessKeySecret: 'test_sk',
        signName: '栖居生活',
        defaultTemplateCode: 'SMS_DEFAULT',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          Code: 'OK',
          BizId: 'aliyun_biz_123',
          Message: 'OK',
        }),
      } as any);

      const res = await provider.send({
        phone: '13800000001',
        templateParam: { code: '123456' },
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('aliyun_biz_123');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://dysmsapi.aliyuncs.com/',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('PhoneNumbers=13800000001'),
        }),
      );
    });

    it('接口返回业务错误时返回失败', async () => {
      const provider = new AliyunSmsProvider({
        accessKeyId: 'test_ak',
        accessKeySecret: 'test_sk',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          Code: 'isv.MOBILE_NUMBER_ILLEGAL',
          Message: '非法手机号',
        }),
      } as any);

      const res = await provider.send({ phone: '13800000001' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('isv.MOBILE_NUMBER_ILLEGAL');
      expect(res.message).toBe('非法手机号');
    });

    it('发生网络异常时优雅返回 NETWORK_ERROR', async () => {
      const provider = new AliyunSmsProvider({
        accessKeyId: 'test_ak',
        accessKeySecret: 'test_sk',
      });

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection timeout'));

      const res = await provider.send({ phone: '13800000001' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('NETWORK_ERROR');
    });
  });

  describe('SmsService', () => {
    let service: SmsService;
    let mockProvider: MockSmsProvider;
    let configService: ConfigService;

    beforeEach(() => {
      mockProvider = new MockSmsProvider();
      configService = new ConfigService({
        ALIYUN_SMS_SIGN_NAME: '栖居生活',
        ALIYUN_SMS_TEMPLATE_CODE_OTP: 'SMS_OTP_TMPL',
      });
      service = new SmsService(mockProvider, configService);
    });

    it('sendOtp 委托提供商下发验证码', async () => {
      const res = await service.sendOtp('13800000001', '654321');
      expect(res.success).toBe(true);
      const latest = mockProvider.getLatestRecord('13800000001');
      expect(latest?.templateCode).toBe('SMS_OTP_TMPL');
      expect(latest?.templateParam).toEqual({ code: '654321' });
    });

    it('sendNotification 发送业务短信', async () => {
      const res = await service.sendNotification('13800000001', '您的账单已生成');
      expect(res.success).toBe(true);
      const latest = mockProvider.getLatestRecord('13800000001');
      expect(latest?.content).toBe('您的账单已生成');
    });

    it('getProviderName 返回当前生效提供商名', () => {
      expect(service.getProviderName()).toBe('mock');
    });
  });
});
