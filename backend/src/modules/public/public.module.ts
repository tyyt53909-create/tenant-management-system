import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BillsModule } from '../bills/bills.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, BillsModule, NotificationsModule, AuthModule],
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
