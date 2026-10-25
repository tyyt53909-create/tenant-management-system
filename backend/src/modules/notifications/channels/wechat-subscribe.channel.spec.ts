import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { WechatSubscribeChannel } from './wechat-subscribe.channel.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WechatApiService } from '../../auth/wechat-api.service.js';
import { WechatSubscribeQuotaService } from '../wechat-subscribe-quota.service.js';

describe('WechatSubscribeChannel', () => {
  let channel: WechatSubscribeChannel;
  let prisma: any;
  let wechatApi: any;
  let quotaService: any;
  let configService: any;

  beforeEach(() => {
    prisma = {
      userIdentity: {
        findFirst: vi.fn(),
      },
    };
    wechatApi = {
      isMockEnabled: vi.fn().mockReturnValue(false),
      sendSubscribeMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: 'ok' }),
    };
    quotaService = {
      getQuota: vi.fn().mockResolvedValue(1),
      decrementQuota: vi.fn().mockResolvedValue(0),
      clearQuota: vi.fn().mockResolvedValue(undefined),
    };
    configService = new ConfigService({
      WECHAT_SUBSCRIBE_TEMPLATE_BILL: 'tmpl-bill-123',
      WECHAT_SUBSCRIBE_TEMPLATE_MAINTENANCE: 'tmpl-maint-123',
      WECHAT_SUBSCRIBE_TEMPLATE_CONTRACT: 'tmpl-contract-123',
    });

    channel = new WechatSubscribeChannel(
      prisma as PrismaService,
      wechatApi as WechatApiService,
      quotaService as WechatSubscribeQuotaService,
      configService as ConfigService,
    );
  });

  it('用户未绑定微信小程序身份时优雅跳过下发', async () => {
    prisma.userIdentity.findFirst.mockResolvedValue(null);

    const result = (await channel.send({
      userId: 'user_without_wx',
      title: '账单提醒',
      body: '请按时缴费',
      priority: 'NORMAL',
    })) as any;

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('NO_WECHAT_IDENTITY');
    expect(wechatApi.sendSubscribeMessage).not.toHaveBeenCalled();
  });

  it('非 mock 模式下额度耗尽跳过下发', async () => {
    prisma.userIdentity.findFirst.mockResolvedValue({
      providerUserId: 'wx_openid_123',
    });
    quotaService.getQuota.mockResolvedValue(0);

    const result = (await channel.send({
      userId: 'user_with_wx',
      title: '账单提醒',
      body: '请按时缴费',
      priority: 'NORMAL',
      data: { type: 'BILL' },
    })) as any;

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('QUOTA_EXHAUSTED');
    expect(wechatApi.sendSubscribeMessage).not.toHaveBeenCalled();
  });

  it('额度充足时调用 wechatApi 发送并扣减额度', async () => {
    prisma.userIdentity.findFirst.mockResolvedValue({
      providerUserId: 'wx_openid_123',
    });
    quotaService.getQuota.mockResolvedValue(2);

    const result = (await channel.send({
      userId: 'user_with_wx',
      title: '账单生成',
      body: '10月租金账单已出',
      priority: 'URGENT',
      data: { type: 'BILL', page: '/packageA/bill-detail/bill-detail?id=b1' },
    })) as any;

    expect(result.success).toBe(true);
    expect(wechatApi.sendSubscribeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        touser: 'wx_openid_123',
        templateId: 'tmpl-bill-123',
        page: '/packageA/bill-detail/bill-detail?id=b1',
        data: expect.objectContaining({
          thing1: { value: '账单生成' },
          thing2: { value: '10月租金账单已出' },
          phrase3: { value: '紧急' },
        }),
      }),
    );
    expect(quotaService.decrementQuota).toHaveBeenCalledWith('user_with_wx', 'tmpl-bill-123');
  });

  it('微信返回 43101 时自动清零额度并优雅降级', async () => {
    prisma.userIdentity.findFirst.mockResolvedValue({
      providerUserId: 'wx_openid_123',
    });
    quotaService.getQuota.mockResolvedValue(1);
    const error43101: any = new Error('user refuse');
    error43101.errcode = 43101;
    wechatApi.sendSubscribeMessage.mockRejectedValue(error43101);

    const result = (await channel.send({
      userId: 'user_with_wx',
      title: '报修进展',
      body: '师傅已接单',
      priority: 'NORMAL',
      data: { type: 'MAINTENANCE' },
    })) as any;

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('USER_REFUSED_OR_QUOTA_EXHAUSTED');
    expect(quotaService.clearQuota).toHaveBeenCalledWith('user_with_wx', 'tmpl-maint-123');
  });
});
