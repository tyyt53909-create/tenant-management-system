import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service.js';
import { AnnouncementsController } from './announcements.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

/**
 * 公告与定向消息（COM-04 / T284）。
 * 依赖通知中心：发布时统一经 NotificationsService 投递，复用站内信 + WebSocket。
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
