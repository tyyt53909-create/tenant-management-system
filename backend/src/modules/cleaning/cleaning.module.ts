import { Module } from '@nestjs/common';
import { CleaningController } from './cleaning.controller.js';
import { CleaningService } from './cleaning.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [CleaningController],
  providers: [CleaningService],
  exports: [CleaningService],
})
export class CleaningModule {}
