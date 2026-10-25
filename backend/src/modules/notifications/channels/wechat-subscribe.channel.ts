import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WechatApiService } from '../../auth/wechat-api.service.js';
import { WechatSubscribeQuotaService } from '../wechat-subscribe-quota.service.js';
import type {
  NotificationChannel,
  NotificationMessage,
} from './notification-channel.js';

@Injectable()
export class WechatSubscribeChannel implements NotificationChannel {
  readonly name = 'wechat';
  private readonly logger = new Logger(WechatSubscribeChannel.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatApi: WechatApiService,
    private readonly quotaService: WechatSubscribeQuotaService,
    private readonly configService: ConfigService,
  ) {}

  async send(message: NotificationMessage): Promise<unknown> {
    // 1. 查找用户的微信小程序 openid
    const identity = await this.prisma.userIdentity.findFirst({
      where: {
        userId: message.userId,
        provider: 'WECHAT_MP',
      },
    });

    if (!identity?.providerUserId) {
      this.logger.debug(
        `用户 ${message.userId} 未绑定微信小程序账号，跳过订阅消息下发`,
      );
      return { skipped: true, reason: 'NO_WECHAT_IDENTITY' };
    }

    const openid = identity.providerUserId;

    // 2. 匹配模板 ID
    const templateId = this.resolveTemplateId(message);

    // 3. 额度预检（在非 mock 环境下必须具有可用额度）
    if (!this.wechatApi.isMockEnabled()) {
      const quota = await this.quotaService.getQuota(message.userId, templateId);
      if (quota <= 0) {
        this.logger.warn(
          `用户 ${message.userId} 在模板 ${templateId} 下无可用订阅额度，跳过微信推送`,
        );
        return { skipped: true, reason: 'QUOTA_EXHAUSTED' };
      }
    }

    // 4. 组装符合微信规范的模板字段与跳转路径
    const page = (message.data?.page as string) || '/pages/index/index';
    const templateData = this.buildTemplateData(message);

    // 5. 下发订阅消息
    try {
      await this.wechatApi.sendSubscribeMessage({
        touser: openid,
        templateId,
        page,
        data: templateData,
      });

      // 发送成功，扣减额度
      await this.quotaService.decrementQuota(message.userId, templateId);
      return { success: true, templateId };
    } catch (error: any) {
      if (error?.errcode === 43101) {
        this.logger.warn(
          `微信下发返回 43101（用户未授权或额度已用完），自动清空本地额度: userId=${message.userId}`,
        );
        await this.quotaService.clearQuota(message.userId, templateId);
        return { skipped: true, reason: 'USER_REFUSED_OR_QUOTA_EXHAUSTED' };
      }

      this.logger.error(`微信订阅消息下发异常: ${error.message || error}`);
      throw error;
    }
  }

  private resolveTemplateId(message: NotificationMessage): string {
    if (message.data?.templateId && typeof message.data.templateId === 'string') {
      return message.data.templateId;
    }

    const type = String(message.data?.type || message.data?.businessType || '').toUpperCase();
    if (type.includes('BILL')) {
      return (
        this.configService.get<string>('WECHAT_SUBSCRIBE_TEMPLATE_BILL') ||
        'mock-tmpl-bill'
      );
    }
    if (type.includes('MAINTENANCE')) {
      return (
        this.configService.get<string>('WECHAT_SUBSCRIBE_TEMPLATE_MAINTENANCE') ||
        'mock-tmpl-maintenance'
      );
    }
    if (type.includes('CONTRACT')) {
      return (
        this.configService.get<string>('WECHAT_SUBSCRIBE_TEMPLATE_CONTRACT') ||
        'mock-tmpl-contract'
      );
    }

    return (
      this.configService.get<string>('WECHAT_SUBSCRIBE_TEMPLATE_BILL') ||
      'mock-tmpl-general'
    );
  }

  private buildTemplateData(message: NotificationMessage): Record<string, { value: string }> {
    if (message.data?.templateData && typeof message.data.templateData === 'object') {
      return message.data.templateData as Record<string, { value: string }>;
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    return {
      thing1: { value: this.truncate(message.title, 20) },
      thing2: { value: this.truncate(message.body, 20) },
      phrase3: { value: message.priority === 'URGENT' ? '紧急' : '普通' },
      time4: { value: dateStr },
    };
  }

  private truncate(str: string, maxLength: number): string {
    if (!str) return '';
    return str.length > maxLength ? str.slice(0, maxLength) : str;
  }
}
