import { Module } from '@nestjs/common';
import { BillsService } from './bills.service.js';
import { BillsController } from './bills.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
