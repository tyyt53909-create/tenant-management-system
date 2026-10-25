import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { WechatApiService } from './wechat-api.service.js';
import { RedisService } from '../../redis/redis.service.js';

describe('WechatApiService', () => {
  let service: WechatApiService;
  let redis: any;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    redis = {
      ready: true,
      client: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Mock 模式', () => {
    beforeEach(() => {
      const config = new ConfigService({
        NODE_ENV: 'test',
        WECHAT_AUTH_MOCK: 'true',
        WECHAT_APPID: '',
        WECHAT_APP_SECRET: '',
      });
      service = new WechatApiService(config, redis as RedisService);
    });

    it('isMockEnabled 返回 true', () => {
      expect(service.isMockEnabled()).toBe(true);
    });

    it('jscode2session 支持 mock-wechat-code 解析 openid 与 unionid', async () => {
      const res = await service.jscode2session('mock-wechat-code:user_openid_1:user_unionid_1');
      expect(res.openid).toBe('user_openid_1');
      expect(res.unionid).toBe('user_unionid_1');
      expect(res.sessionKey).toBe('mock-session-key');
    });

    it('jscode2session 遇到 mock-wechat-invalid 抛出 AUTH_WECHAT_CODE_INVALID', async () => {
      await expect(service.jscode2session('mock-wechat-invalid')).rejects.toThrow(
        /微信授权码无效或已过期/,
      );
    });

    it('getStableAccessToken 返回测试 Token', async () => {
      const token = await service.getStableAccessToken();
      expect(token).toBe('mock-wechat-stable-access-token');
    });

    it('getPhoneNumber 支持 mock-wechat-phone 解析手机号', async () => {
      const phone = await service.getPhoneNumber('mock-wechat-phone:13912345678');
      expect(phone).toBe('13912345678');
    });

    it('sendSubscribeMessage mock 模式下正常返回 ok', async () => {
      const res = await service.sendSubscribeMessage({
        touser: 'mock-openid-1',
        templateId: 'tmpl-1',
        data: { thing1: { value: 'test' } },
      });
      expect(res.errcode).toBe(0);
    });

    it('sendSubscribeMessage mock 模式遇到 mock-quota-exhausted 抛出 43101', async () => {
      await expect(
        service.sendSubscribeMessage({
          touser: 'mock-quota-exhausted',
          templateId: 'tmpl-1',
          data: { thing1: { value: 'test' } },
        }),
      ).rejects.toMatchObject({ errcode: 43101 });
    });
  });

  describe('真实网络请求模式', () => {
    beforeEach(() => {
      const config = new ConfigService({
        NODE_ENV: 'test',
        WECHAT_AUTH_MOCK: 'false',
        WECHAT_APPID: 'wx_real_appid',
        WECHAT_APP_SECRET: 'wx_real_appsecret',
      });
      service = new WechatApiService(config, redis as RedisService);
    });

    it('jscode2session 成功时返回 openid 并将 session_key 写入 Redis 短存', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          openid: 'wx_real_openid',
          session_key: 'sk_secret_123',
          unionid: 'wx_real_unionid',
          errcode: 0,
        }),
      } as any);

      const res = await service.jscode2session('real_js_code');
      expect(res.openid).toBe('wx_real_openid');
      expect(res.sessionKey).toBe('sk_secret_123');
      expect(redis.client.set).toHaveBeenCalledWith(
        'wechat:session_key:wx_real_openid',
        'sk_secret_123',
        'PX',
        1800000,
      );
    });

    it('jscode2session 微信返回 40029 时抛出错误码', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          errcode: 40029,
          errmsg: 'invalid code',
        }),
      } as any);

      await expect(service.jscode2session('bad_code')).rejects.toThrow(/微信授权码无效或已过期/);
    });

    it('getStableAccessToken 单飞并发请求只触发一次远端刷新', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount += 1;
        await new Promise((r) => setTimeout(r, 10));
        return {
          json: async () => ({
            access_token: 'wx_access_token_123',
            expires_in: 7200,
          }),
        };
      });

      const [t1, t2] = await Promise.all([
        service.getStableAccessToken(),
        service.getStableAccessToken(),
      ]);

      expect(t1).toBe('wx_access_token_123');
      expect(t2).toBe('wx_access_token_123');
      expect(callCount).toBe(1);
      expect(redis.client.set).toHaveBeenCalledWith(
        'wechat:access_token:wx_real_appid',
        'wx_access_token_123',
        'PX',
        6900000,
      );
    });

    it('getPhoneNumber 在 token 过期 (40001) 时自动刷新并重试一次', async () => {
      let phoneCall = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('stable_token')) {
          return {
            json: async () => ({ access_token: 'new_token', expires_in: 7200 }),
          };
        }
        phoneCall += 1;
        if (phoneCall === 1) {
          return {
            json: async () => ({ errcode: 40001, errmsg: 'token expired' }),
          };
        }
        return {
          json: async () => ({
            errcode: 0,
            phone_info: { purePhoneNumber: '13888889999' },
          }),
        };
      });

      const phone = await service.getPhoneNumber('phone_auth_code');
      expect(phone).toBe('13888889999');
      expect(phoneCall).toBe(2);
    });

    it('未配置凭据且关闭 mock 时抛出 ServiceUnavailableException', async () => {
      const emptyConfig = new ConfigService({
        NODE_ENV: 'test',
        WECHAT_AUTH_MOCK: 'false',
        WECHAT_APPID: '',
        WECHAT_APP_SECRET: '',
      });
      const unconfigured = new WechatApiService(emptyConfig, redis as RedisService);

      await expect(unconfigured.jscode2session('any_code')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('getAppId 返回已配置的 appId', () => {
      expect(service.getAppId()).toBe('wx_real_appid');
    });

    it('入参为空时直接抛出 BadRequestException', async () => {
      await expect(service.jscode2session('')).rejects.toThrow('无效的微信授权 code');
      await expect(service.getPhoneNumber('')).rejects.toThrow('无效的手机号授权凭证');
    });

    it('微信网络请求发生异常时抛出 ServiceUnavailableException', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      await expect(service.jscode2session('valid_code')).rejects.toThrow(/无法连接微信服务器/);
    });

    it('Redis 关闭时 setCache 与 getCache 优雅回退到进程内存缓存', async () => {
      redis.ready = false;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('stable_token')) {
          return {
            json: async () => ({ access_token: 'mem_cached_token', expires_in: 7200 }),
          };
        }
        return {
          json: async () => ({
            errcode: 0,
            phone_info: { purePhoneNumber: '13666667777' },
          }),
        };
      });

      const phone = await service.getPhoneNumber('code_mem_phone');
      expect(phone).toBe('13666667777');

      // 第二次获取 token 应命中进程内存缓存
      const token = await service.getStableAccessToken();
      expect(token).toBe('mem_cached_token');
    });

    it('sendSubscribeMessage 参数不完整抛出 BadRequestException', async () => {
      await expect(
        service.sendSubscribeMessage({ touser: '', templateId: 't', data: {} } as any),
      ).rejects.toThrow('订阅消息参数不完整');
    });

    it('sendSubscribeMessage 发送成功返回 errcode 0', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('stable_token')) {
          return {
            json: async () => ({ access_token: 'msg_token', expires_in: 7200 }),
          };
        }
        return {
          json: async () => ({ errcode: 0, errmsg: 'ok' }),
        };
      });

      const res = await service.sendSubscribeMessage({
        touser: 'real_openid',
        templateId: 'tmpl_1',
        data: { thing1: { value: 'test' } },
      });
      expect(res.errcode).toBe(0);
    });

    it('sendSubscribeMessage 微信返回 40001 时强制刷新 token 并重试一次', async () => {
      let sendCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('stable_token')) {
          return {
            json: async () => ({ access_token: 'refreshed_token', expires_in: 7200 }),
          };
        }
        sendCount += 1;
        if (sendCount === 1) {
          return { json: async () => ({ errcode: 40001, errmsg: 'access_token expired' }) };
        }
        return { json: async () => ({ errcode: 0, errmsg: 'ok' }) };
      });

      const res = await service.sendSubscribeMessage({
        touser: 'real_openid',
        templateId: 'tmpl_1',
        data: { thing1: { value: 'test' } },
      });
      expect(res.errcode).toBe(0);
      expect(sendCount).toBe(2);
    });

    it('sendSubscribeMessage 网络异常抛出 ServiceUnavailableException', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('stable_token')) {
          return { json: async () => ({ access_token: 't', expires_in: 7200 }) };
        }
        throw new Error('connection timeout');
      });

      await expect(
        service.sendSubscribeMessage({
          touser: 'real_openid',
          templateId: 'tmpl_1',
          data: { thing1: { value: 'test' } },
        }),
      ).rejects.toThrow(/无法连接微信订阅消息服务/);
    });
  });
});
