import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UtilityReadinessController } from './utility-readiness.controller.js';
import { UtilityReadinessService } from './utility-readiness.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [UtilityReadinessController],
  providers: [UtilityReadinessService],
})
export class UtilityReadinessModule {}
