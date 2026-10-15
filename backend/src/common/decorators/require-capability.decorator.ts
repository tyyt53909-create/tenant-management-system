import { SetMetadata } from '@nestjs/common';
import { TenantCapabilityCode } from '../../modules/tenant-capabilities/tenant-capability.catalog.js';

export const REQUIRE_CAPABILITY_KEY = 'require_capability';

/**
 * 标记接口所需的租客能力代码
 * 仅对 TENANT 角色进行能力拦截，非租客（如 ADMIN、CLEANER）直接放行
 */
export const RequireCapability = (capability: TenantCapabilityCode) =>
  SetMetadata(REQUIRE_CAPABILITY_KEY, capability);
