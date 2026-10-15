import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_CAPABILITY_KEY } from '../decorators/require-capability.decorator.js';
import { TenantCapabilityService } from '../../modules/tenant-capabilities/tenant-capability.service.js';

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly capabilityService?: TenantCapabilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredCapability = this.reflector.getAllAndOverride<string>(
      REQUIRE_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredCapability) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 未认证交给前面的 JwtAuthGuard。非租客角色不受这张表限制。
    if (!user || user.role !== 'TENANT') {
      return true;
    }

    // 接口已要求能力且请求方为租客，但守卫没有拿到服务：拒绝，避免漏注入变成全部放行
    if (!this.capabilityService) {
      throw new ForbiddenException('CAPABILITY_DENIED');
    }

    const userId = user.userId || user.id || user.sub;
    if (!userId) {
      throw new ForbiddenException('CAPABILITY_DENIED');
    }

    const isAllowed = await this.capabilityService.hasCapability(userId, requiredCapability);
    if (!isAllowed) {
      throw new ForbiddenException('CAPABILITY_DENIED');
    }

    return true;
  }
}
