import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service.js';
import { RoomsController } from './rooms.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
