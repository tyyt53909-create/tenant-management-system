import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { NotificationDispatcher } from './channels/notification-dispatcher.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    {
      // 渠道清单只在模块装配一次；测试与 Worker 复用同一构造方式。
      provide: NotificationDispatcher,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => NotificationDispatcher.createDefault(prisma),
    },
  ],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
