import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service.js';
import { BuildingsController } from './buildings.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [BuildingsController],
  providers: [BuildingsService],
  exports: [BuildingsService],
})
export class BuildingsModule {}
