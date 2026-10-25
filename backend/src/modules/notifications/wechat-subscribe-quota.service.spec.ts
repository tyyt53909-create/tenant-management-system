import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WechatSubscribeQuotaService } from './wechat-subscribe-quota.service.js';
import { RedisService } from '../../redis/redis.service.js';

describe('WechatSubscribeQuotaService', () => {
  let service: WechatSubscribeQuotaService;
  let redis: any;

  describe('Redis 正常模式', () => {
    beforeEach(() => {
      redis = {
        ready: true,
        client: {
          get: vi.fn().mockResolvedValue('3'),
          incr: vi.fn().mockResolvedValue(4),
          pexpire: vi.fn().mockResolvedValue(1),
          eval: vi.fn().mockResolvedValue(2),
          del: vi.fn().mockResolvedValue(1),
        },
      };
      service = new WechatSubscribeQuotaService(redis as RedisService);
    });

    it('getQuota 从 Redis 读取整数额度', async () => {
      const q = await service.getQuota('user1', 'tmpl1');
      expect(q).toBe(3);
      expect(redis.client.get).toHaveBeenCalledWith('wechat:subscribe_quota:user1:tmpl1');
    });

    it('incrementQuota 累加额度并设置过期时间', async () => {
      const q = await service.incrementQuota('user1', 'tmpl1', 1);
      expect(q).toBe(4);
      expect(redis.client.incr).toHaveBeenCalledWith('wechat:subscribe_quota:user1:tmpl1');
      expect(redis.client.pexpire).toHaveBeenCalled();
    });

    it('decrementQuota 执行 Lua 原子扣减', async () => {
      const remaining = await service.decrementQuota('user1', 'tmpl1');
      expect(remaining).toBe(2);
      expect(redis.client.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'wechat:subscribe_quota:user1:tmpl1',
      );
    });

    it('clearQuota 删除 Redis 键', async () => {
      await service.clearQuota('user1', 'tmpl1');
      expect(redis.client.del).toHaveBeenCalledWith('wechat:subscribe_quota:user1:tmpl1');
    });

    it('recordReport: accept 增加额度', async () => {
      const res = await service.recordReport('user1', 'tmpl1', 'accept');
      expect(res.status).toBe('ACCEPTED');
      expect(res.quota).toBe(4);
    });

    it('recordReport: reject 保持原额度', async () => {
      const res = await service.recordReport('user1', 'tmpl1', 'reject');
      expect(res.status).toBe('REJECTED');
      expect(res.quota).toBe(3);
    });

    it('recordReport: ban 清空额度', async () => {
      const res = await service.recordReport('user1', 'tmpl1', 'ban');
      expect(res.status).toBe('BANNED');
      expect(res.quota).toBe(0);
    });
  });

  describe('内存降级模式', () => {
    beforeEach(() => {
      redis = { ready: false, client: null };
      service = new WechatSubscribeQuotaService(redis as RedisService);
    });

    it('未设置时默认 0', async () => {
      expect(await service.getQuota('u_mem', 't_mem')).toBe(0);
    });

    it('内存中累加与扣减', async () => {
      expect(await service.incrementQuota('u_mem', 't_mem', 2)).toBe(2);
      expect(await service.getQuota('u_mem', 't_mem')).toBe(2);
      expect(await service.decrementQuota('u_mem', 't_mem')).toBe(1);
      await service.clearQuota('u_mem', 't_mem');
      expect(await service.getQuota('u_mem', 't_mem')).toBe(0);
    });
  });
});
