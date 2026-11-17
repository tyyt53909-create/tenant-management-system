import { Module } from '@nestjs/common';
import { MetersModule } from '../meters/meters.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PeriodicChargesController } from './periodic-charges.controller.js';
import { PeriodicChargesService } from './periodic-charges.service.js';

@Module({
  imports: [PrismaModule, MetersModule, NotificationsModule],
  controllers: [PeriodicChargesController],
  providers: [PeriodicChargesService],
})
export class PeriodicChargesModule {}
