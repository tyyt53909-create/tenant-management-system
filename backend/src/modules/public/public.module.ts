import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BillsModule } from '../bills/bills.module.js';

@Module({
  imports: [PrismaModule, BillsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
