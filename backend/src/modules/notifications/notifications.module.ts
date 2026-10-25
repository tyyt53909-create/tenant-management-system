import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotificationDispatcher } from './channels/notification-dispatcher.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InAppChannel } from './channels/in-app.channel.js';
import { EmailChannel } from './channels/email.channel.js';
import { WechatSubscribeChannel } from './channels/wechat-subscribe.channel.js';
import { SmsChannel } from './channels/sms.channel.js';
import { WechatSubscribeQuotaService } from './wechat-subscribe-quota.service.js';
import { RedisModule } from '../../redis/redis.module.js';
import { SmsModule } from '../sms/sms.module.js';

@Module({
  imports: [PrismaModule, AuthModule, RedisModule, SmsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    WechatSubscribeQuotaService,
    WechatSubscribeChannel,
    SmsChannel,
    {
      // 渠道清单只在模块装配一次；测试与 Worker 复用同一构造方式。
      provide: NotificationDispatcher,
      inject: [PrismaService, WechatSubscribeChannel, SmsChannel],
      useFactory: (
        prisma: PrismaService,
        wechatChannel: WechatSubscribeChannel,
        smsChannel: SmsChannel,
      ) =>
        new NotificationDispatcher([
          new InAppChannel(prisma),
          new EmailChannel(),
          wechatChannel,
          smsChannel,
        ]),
    },
  ],
  exports: [
    NotificationsService,
    NotificationsGateway,
    WechatSubscribeQuotaService,
    WechatSubscribeChannel,
    SmsChannel,
  ],
})
export class NotificationsModule {}
