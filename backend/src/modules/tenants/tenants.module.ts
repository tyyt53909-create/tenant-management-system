import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantsController } from './tenants.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditLogModule } from '../audit/audit.module.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [TenantsController],
  providers: [TenantsService, CryptoService],
  exports: [TenantsService],
})
export class TenantsModule {}
