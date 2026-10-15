import { Module, Global } from '@nestjs/common';
import { TenantCapabilityService } from './tenant-capability.service.js';
import { TenantCapabilitiesController } from './tenant-capabilities.controller.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { AuditLogModule } from '../audit/audit.module.js';

@Global()
@Module({
  imports: [AuditLogModule],
  controllers: [TenantCapabilitiesController],
  providers: [TenantCapabilityService, CapabilityGuard],
  exports: [TenantCapabilityService, CapabilityGuard],
})
export class TenantCapabilitiesModule {}
