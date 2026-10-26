import { Module } from '@nestjs/common';
import { CheckoutService } from './checkout.service.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutRequestsService } from './checkout-requests.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PrismaModule, SettingsModule, NotificationsModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, CheckoutRequestsService],
  exports: [CheckoutService, CheckoutRequestsService],
})
export class CheckoutModule {}
