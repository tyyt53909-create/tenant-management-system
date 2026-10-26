import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrepayService } from './prepay.service.js';
import { PrepayController } from './prepay.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BillsModule } from '../bills/bills.module.js';

@Module({
  imports: [PrismaModule, SettingsModule, ConfigModule, forwardRef(() => BillsModule)],
  controllers: [PrepayController],
  providers: [PrepayService],
  exports: [PrepayService],
})
export class PrepayModule {}
