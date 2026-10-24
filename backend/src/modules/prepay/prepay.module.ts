import { Module } from '@nestjs/common';
import { PrepayService } from './prepay.service.js';
import { PrepayController } from './prepay.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [PrepayController],
  providers: [PrepayService],
  exports: [PrepayService],
})
export class PrepayModule {}
