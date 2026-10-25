import { Module, forwardRef } from '@nestjs/common';
import { PrepayService } from './prepay.service.js';
import { PrepayController } from './prepay.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BillsModule } from '../bills/bills.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    forwardRef(() => BillsModule),
    NotificationsModule,
  ],
  controllers: [PrepayController],
  providers: [PrepayService],
  exports: [PrepayService],
})
export class PrepayModule {}
