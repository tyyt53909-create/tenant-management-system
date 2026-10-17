import {
  Controller,
  Get,
  Patch,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { TenantCapabilityService } from './tenant-capability.service.js';
import { UpdateTenantAccountDto } from './dto/update-tenant-account.dto.js';
import { UpdateTenantCapabilitiesDto } from './dto/update-tenant-capabilities.dto.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';

interface RequestWithUser extends Partial<ExpressRequest> {
  user?: AuthUser;
}

@Controller('tenants/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class TenantCapabilitiesController {
  constructor(private readonly capabilityService: TenantCapabilityService) {}

  /**
   * 查看租客账号状态（GET /tenants/:id/account）
   */
  @Get('account')
  getAccount(@Param('id') tenantId: string) {
    return this.capabilityService.getAccount(tenantId);
  }

  /**
   * 启用 / 禁用租客登录账号（PATCH /tenants/:id/account）
   */
  @Patch('account')
  updateAccount(
    @Param('id') tenantId: string,
    @Body() dto: UpdateTenantAccountDto,
    @Request() req: RequestWithUser,
  ) {
    const actorId = req.user?.userId || req.user?.id || 'admin';
    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = (req.headers?.['user-agent'] as string) || '';
    return this.capabilityService.updateAccount(tenantId, dto.isActive, actorId, ip, userAgent);
  }

  /**
   * 查看租客功能能力清单与生效覆盖配置（GET /tenants/:id/capabilities）
   */
  @Get('capabilities')
  getCapabilities(@Param('id') tenantId: string) {
    return this.capabilityService.getCapabilities(tenantId);
  }

  /**
   * 整批替换租客能力的 DENY 屏蔽项（PUT /tenants/:id/capabilities）
   */
  @Put('capabilities')
  updateCapabilities(
    @Param('id') tenantId: string,
    @Body() dto: UpdateTenantCapabilitiesDto,
    @Request() req: RequestWithUser,
  ) {
    const actorId = req.user?.userId || req.user?.id || 'admin';
    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = (req.headers?.['user-agent'] as string) || '';
    return this.capabilityService.replaceCapabilities(
      tenantId,
      dto.denied,
      actorId,
      dto.reasons,
      ip,
      userAgent,
    );
  }
}
