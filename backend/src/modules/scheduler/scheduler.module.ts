import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service.js';
import { SchedulerDailyJobsService } from './scheduler-daily-jobs.service.js';
import { SchedulerMonthlyBillsService } from './scheduler-monthly-bills.service.js';
import { SchedulerController } from './scheduler.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BillsModule } from '../bills/bills.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { JobsModule } from '../jobs/jobs.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, BillsModule, NotificationsModule, JobsModule],
  controllers: [SchedulerController],
  providers: [SchedulerDailyJobsService, SchedulerMonthlyBillsService, SchedulerService],
  exports: [SchedulerDailyJobsService, SchedulerMonthlyBillsService, SchedulerService],
})
export class SchedulerModule {}
