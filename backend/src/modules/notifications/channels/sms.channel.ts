import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SmsService } from '../../sms/sms.service.js';
import type {
  NotificationChannel,
  NotificationMessage,
} from './notification-channel.js';

@Injectable()
export class SmsChannel implements NotificationChannel {
  readonly name = 'sms';
  private readonly logger = new Logger(SmsChannel.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
  ) {}

  async send(message: NotificationMessage): Promise<unknown> {
    let phone = message.phone;

    if (!phone) {
      const user = await this.prisma.user.findUnique({
        where: { id: message.userId },
        select: { phone: true },
      });
      phone = user?.phone;
    }

    if (!phone) {
      this.logger.debug(`用户 ${message.userId} 未绑定手机号，跳过短信通知`);
      return { skipped: true, reason: 'NO_PHONE' };
    }

    const content = `${message.title}：${message.body}`;
    try {
      const result = await this.smsService.sendNotification(phone, content);
      if (!result.success) {
        this.logger.warn(`短信下发失败: ${result.message || result.code}`);
        return { success: false, error: result.message };
      }
      return { success: true, messageId: result.messageId };
    } catch (error: any) {
      this.logger.error(`短信渠道发送异常: ${error.message || error}`);
      throw error;
    }
  }
}
