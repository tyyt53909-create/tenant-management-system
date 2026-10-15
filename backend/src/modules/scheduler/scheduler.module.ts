import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BillsModule } from '../bills/bills.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, BillsModule, NotificationsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}
