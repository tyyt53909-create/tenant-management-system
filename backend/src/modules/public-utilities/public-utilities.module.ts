import { Module } from '@nestjs/common';
import { PublicUtilitiesService } from './public-utilities.service.js';
import { PublicUtilitiesController } from './public-utilities.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogModule } from '../audit/audit.module.js';
import { MetersModule } from '../meters/meters.module.js';

@Module({
  imports: [PrismaModule, AuditLogModule, MetersModule],
  controllers: [PublicUtilitiesController],
  providers: [PublicUtilitiesService],
})
export class PublicUtilitiesModule {}
