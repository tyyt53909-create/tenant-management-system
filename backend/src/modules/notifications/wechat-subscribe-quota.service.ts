import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';

const QUOTA_KEY_PREFIX = 'wechat:subscribe_quota:';
const DEFAULT_QUOTA_TTL_SECONDS = 30 * 24 * 3600; // 额度保留 30 天

@Injectable()
export class WechatSubscribeQuotaService {
  private readonly logger = new Logger(WechatSubscribeQuotaService.name);
  private readonly memoryQuota = new Map<string, number>();

  constructor(private readonly redisService: RedisService) {}

  /**
   * 获取指定用户在特定模板下的可用订阅消息额度
   */
  async getQuota(userId: string, templateId: string): Promise<number> {
    const key = this.buildKey(userId, templateId);
    if (this.redisService.ready && this.redisService.client) {
      try {
        const val = await this.redisService.client.get(key);
        return val ? Math.max(0, parseInt(val, 10) || 0) : 0;
      } catch (err) {
        this.logger.warn(`Redis getQuota 失败，降级内存: ${err}`);
      }
    }
    return this.memoryQuota.get(key) ?? 0;
  }

  /**
   * 增加额度（通常由用户在小程序端授权 accept 后触发）
   */
  async incrementQuota(userId: string, templateId: string, delta = 1): Promise<number> {
    const key = this.buildKey(userId, templateId);
    if (this.redisService.ready && this.redisService.client) {
      try {
        const newCount = await this.redisService.client.incr(key);
        await this.redisService.client.pexpire(key, DEFAULT_QUOTA_TTL_SECONDS * 1000);
        this.memoryQuota.set(key, newCount);
        return newCount;
      } catch (err) {
        this.logger.warn(`Redis incrementQuota 失败，降级内存: ${err}`);
      }
    }
    const current = this.memoryQuota.get(key) ?? 0;
    const updated = Math.max(0, current + delta);
    this.memoryQuota.set(key, updated);
    return updated;
  }

  /**
   * 扣减额度（下发一条订阅消息成功后触发）
   */
  async decrementQuota(userId: string, templateId: string): Promise<number> {
    const key = this.buildKey(userId, templateId);
    if (this.redisService.ready && this.redisService.client) {
      try {
        // Lua 保证原子减且不低于 0
        const script = `
          local val = redis.call('get', KEYS[1])
          if not val or tonumber(val) <= 0 then
            redis.call('set', KEYS[1], '0')
            return 0
          else
            local remaining = redis.call('decr', KEYS[1])
            return remaining
          end
        `;
        const res = (await this.redisService.client.eval(script, 1, key)) as number;
        this.memoryQuota.set(key, res);
        return res;
      } catch (err) {
        this.logger.warn(`Redis decrementQuota 失败，降级内存: ${err}`);
      }
    }
    const current = this.memoryQuota.get(key) ?? 0;
    const updated = Math.max(0, current - 1);
    this.memoryQuota.set(key, updated);
    return updated;
  }

  /**
   * 清空额度（用户退订、拒收或微信返回 43101 时触发）
   */
  async clearQuota(userId: string, templateId: string): Promise<void> {
    const key = this.buildKey(userId, templateId);
    if (this.redisService.ready && this.redisService.client) {
      try {
        await this.redisService.client.del(key);
      } catch (err) {
        this.logger.warn(`Redis clearQuota 失败，降级内存: ${err}`);
      }
    }
    this.memoryQuota.delete(key);
  }

  /**
   * 处理小程序端上报的订阅授权结果
   */
  async recordReport(
    userId: string,
    templateId: string,
    action: 'accept' | 'reject' | 'ban',
  ): Promise<{ templateId: string; quota: number; status: string }> {
    if (action === 'accept') {
      const quota = await this.incrementQuota(userId, templateId, 1);
      return { templateId, quota, status: 'ACCEPTED' };
    }
    if (action === 'ban') {
      await this.clearQuota(userId, templateId);
      return { templateId, quota: 0, status: 'BANNED' };
    }
    // reject
    const quota = await this.getQuota(userId, templateId);
    return { templateId, quota, status: 'REJECTED' };
  }

  private buildKey(userId: string, templateId: string): string {
    return `${QUOTA_KEY_PREFIX}${userId}:${templateId}`;
  }
}
