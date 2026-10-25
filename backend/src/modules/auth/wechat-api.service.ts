import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';

export interface WechatSessionResult {
  openid: string;
  sessionKey: string;
  unionid?: string;
}

const WECHAT_SESSION_TTL_SECONDS = 1800; // 30 分钟

@Injectable()
export class WechatApiService {
  private readonly logger = new Logger(WechatApiService.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private inFlightTokenPromise: Promise<string> | null = null;
  private memoryCache = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.appId = this.configService.get<string>('WECHAT_APPID')?.trim() || '';
    this.appSecret = this.configService.get<string>('WECHAT_APP_SECRET')?.trim() || '';
  }

  getAppId(): string {
    return this.appId;
  }

  isMockEnabled(): boolean {
    return (
      this.configService.get<string>('WECHAT_AUTH_MOCK') === 'true' &&
      this.configService.get<string>('NODE_ENV') !== 'production'
    );
  }

  /**
   * jscode2session 换取 openid / session_key / unionid
   */
  async jscode2session(code: string): Promise<WechatSessionResult> {
    if (!code || typeof code !== 'string') {
      throw new BadRequestException('无效的微信授权 code');
    }

    if (this.isMockEnabled() && (code.startsWith('mock-wechat-') || !this.appId)) {
      return this.mockJscode2session(code);
    }

    if (!this.appId || !this.appSecret) {
      throw new ServiceUnavailableException(
        '服务端未配置 WECHAT_APPID 或 WECHAT_APP_SECRET，微信登录暂不可用',
      );
    }

    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', this.appId);
    url.searchParams.set('secret', this.appSecret);
    url.searchParams.set('js_code', code.trim());
    url.searchParams.set('grant_type', 'authorization_code');

    let data: any;
    try {
      const res = await fetch(url.toString(), { method: 'GET' });
      data = await res.json();
    } catch (error: any) {
      this.logger.error(`微信 jscode2session 网络异常: ${error.message}`);
      throw new ServiceUnavailableException('无法连接微信服务器，请稍后重试');
    }

    if (data.errcode === 40029) {
      throw apiError(ErrorCode.AUTH_WECHAT_CODE_INVALID, '微信授权码无效或已过期');
    }
    if (data.errcode && data.errcode !== 0) {
      this.logger.warn(`微信 jscode2session 失败: errcode=${data.errcode}, errmsg=${data.errmsg}`);
      throw new BadRequestException(`微信授权失败: ${data.errmsg || '未知错误'}`);
    }

    if (!data.openid) {
      throw new BadRequestException('微信授权响应缺少 openid');
    }

    // session_key 仅存入 Redis 短 TTL 缓存，绝不写入普通日志或回传前端
    await this.cacheSessionKey(data.openid, data.session_key);

    return {
      openid: data.openid,
      sessionKey: data.session_key,
      unionid: data.unionid,
    };
  }

  /**
   * 获取微信全局 access_token（采用官方推荐稳定版 cgi-bin/stable_token）
   * 单飞防击穿，到期前 5 分钟刷新，与 WX-02 / 手机号接口共用。
   */
  async getStableAccessToken(forceRefresh = false): Promise<string> {
    if (this.isMockEnabled() && !this.appId) {
      return 'mock-wechat-stable-access-token';
    }

    const cacheKey = `wechat:access_token:${this.appId}`;
    if (!forceRefresh) {
      const cached = await this.getCache(cacheKey);
      if (cached) return cached;
    }

    if (this.inFlightTokenPromise) {
      return this.inFlightTokenPromise;
    }

    this.inFlightTokenPromise = (async () => {
      try {
        if (!this.appId || !this.appSecret) {
          throw new ServiceUnavailableException('服务端未配置 WECHAT_APPID 或 WECHAT_APP_SECRET');
        }

        const url = 'https://api.weixin.qq.com/cgi-bin/stable_token';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'client_credential',
            appid: this.appId,
            secret: this.appSecret,
            force_refresh: forceRefresh,
          }),
        });
        const data = await res.json();
        if (data.errcode && data.errcode !== 0) {
          throw new Error(`微信获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
        }

        const token = data.access_token as string;
        const expiresInSeconds = Math.max(Number(data.expires_in) || 7200, 600);
        // 到期前 5 分钟 (300 秒) 刷新
        const ttlSeconds = Math.max(expiresInSeconds - 300, 300);
        await this.setCache(cacheKey, token, ttlSeconds);
        return token;
      } finally {
        this.inFlightTokenPromise = null;
      }
    })();

    return this.inFlightTokenPromise;
  }

  /**
   * 通过手机号快速验证 code 换取真实手机号
   */
  async getPhoneNumber(phoneCode: string): Promise<string> {
    if (!phoneCode || typeof phoneCode !== 'string') {
      throw new BadRequestException('无效的手机号授权凭证');
    }

    if (this.isMockEnabled() && (phoneCode.startsWith('mock-wechat-') || !this.appId)) {
      return this.mockGetPhoneNumber(phoneCode);
    }

    let token = await this.getStableAccessToken();
    let data = await this.doGetPhoneNumber(token, phoneCode);

    // 40001: access_token 异常，强制刷新一次并重试
    if (data.errcode === 40001 || data.errcode === 42001) {
      this.logger.warn('微信 access_token 失效，强制刷新后重试一次');
      token = await this.getStableAccessToken(true);
      data = await this.doGetPhoneNumber(token, phoneCode);
    }

    if (data.errcode && data.errcode !== 0) {
      this.logger.warn(`获取微信手机号失败: errcode=${data.errcode}, errmsg=${data.errmsg}`);
      throw new BadRequestException(`获取微信手机号失败: ${data.errmsg || '授权已失效'}`);
    }

    const phoneInfo = data.phone_info;
    const phone = phoneInfo?.purePhoneNumber || phoneInfo?.phoneNumber;
    if (!phone) {
      throw new BadRequestException('微信手机号响应未包含有效号码');
    }

    return String(phone).trim();
  }

  private async doGetPhoneNumber(accessToken: string, code: string): Promise<any> {
    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      return await res.json();
    } catch (error: any) {
      this.logger.error(`微信 getuserphonenumber 网络异常: ${error.message}`);
      throw new ServiceUnavailableException('无法连接微信手机号服务，请稍后重试');
    }
  }

  private async cacheSessionKey(openid: string, sessionKey: string): Promise<void> {
    const key = `wechat:session_key:${openid}`;
    await this.setCache(key, sessionKey, WECHAT_SESSION_TTL_SECONDS);
  }

  private mockJscode2session(code: string): WechatSessionResult {
    if (code === 'mock-wechat-invalid') {
      throw apiError(ErrorCode.AUTH_WECHAT_CODE_INVALID, '微信授权码无效或已过期');
    }

    if (code.startsWith('mock-wechat-code:')) {
      const parts = code.split(':');
      const openid = parts[1] || `mock-openid-${Date.now()}`;
      const unionid = parts[2] || undefined;
      return { openid, sessionKey: 'mock-session-key', unionid };
    }

    return {
      openid: `mock-openid-${code.slice(0, 12)}`,
      sessionKey: 'mock-session-key',
    };
  }

  private mockGetPhoneNumber(code: string): string {
    if (code.startsWith('mock-wechat-phone:')) {
      return code.split(':')[1] || '13900000001';
    }
    return '13900000001';
  }

  private async getCache(key: string): Promise<string | null> {
    if (this.redisService.ready && this.redisService.client) {
      try {
        return await this.redisService.client.get(key);
      } catch {
        // fallback to memory
      }
    }
    const mem = this.memoryCache.get(key);
    if (!mem) return null;
    if (Date.now() > mem.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }
    return mem.value;
  }

  private async setCache(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redisService.ready && this.redisService.client) {
      try {
        await this.redisService.client.set(key, value, 'PX', ttlSeconds * 1000);
        return;
      } catch {
        // fallback to memory
      }
    }
    this.memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
