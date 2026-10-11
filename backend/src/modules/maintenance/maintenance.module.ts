import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceController } from './maintenance.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
