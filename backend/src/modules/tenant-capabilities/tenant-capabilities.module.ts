import { Module, Global, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantCapabilityService } from './tenant-capability.service.js';
import { TenantCapabilitiesController } from './tenant-capabilities.controller.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { AuditLogModule } from '../audit/audit.module.js';

@Global()
@Module({
  imports: [AuditLogModule, forwardRef(() => AuthModule)],
  controllers: [TenantCapabilitiesController],
  providers: [TenantCapabilityService, CapabilityGuard],
  exports: [TenantCapabilityService, CapabilityGuard],
})
export class TenantCapabilitiesModule {}
