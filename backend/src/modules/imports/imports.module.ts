import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service.js';
import { ImportsController } from './imports.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogModule } from '../audit/audit.module.js';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
