import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DepositsService } from './deposits.service.js';
import { DepositsController } from './deposits.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService],
})
export class DepositsModule {}
