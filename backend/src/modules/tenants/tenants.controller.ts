import { Controller, Get, Post, Body, Patch, Put, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { TenantsService } from './tenants.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { QueryTenantsDto } from './dto/query-tenants.dto.js';
import { UpsertTenantRegistrationDto } from './dto/upsert-tenant-registration.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam, type AuthUser } from '../../common/decorators/current-user.decorator.js';

/** 审计上下文：只需要 user / ip / user-agent，避免用 `any` 拿整个 express 请求（Partial 便于单测直接传最小对象） */
type AuditRequestContext = Partial<ExpressRequest> & { user?: AuthUser };

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  // 租客列表：仅管理者（docs/03-权限矩阵.md §3.2，保洁/租客均不可见租客列表）
  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryTenantsDto) {
    return this.tenantsService.findAll(query);
  }

  @Get(':id/id-number')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  revealIdNumber(@Request() req: AuditRequestContext, @Param('id') id: string) {
    return this.tenantsService.revealIdNumber(id, {
      userId: req.user?.userId ?? '',
      ip: req.ip ?? 'unknown',
      userAgent: req.headers?.['user-agent'] ?? 'unknown',
    });
  }

  @Get(':id/registration')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getRegistration(@Param('id') id: string) {
    return this.tenantsService.getRegistration(id);
  }

  @Put(':id/registration')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  upsertRegistration(
    @Request() req: AuditRequestContext,
    @Param('id') id: string,
    @Body() dto: UpsertTenantRegistrationDto,
  ) {
    return this.tenantsService.upsertRegistration(id, dto, {
      userId: req.user?.userId ?? '',
      ip: req.ip ?? 'unknown',
      userAgent: req.headers?.['user-agent'] ?? 'unknown',
    });
  }

  // 租客详情：管理者看全部；租客仅可看自己（越权按 404 处理）
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TENANT')
  findOne(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      return this.tenantsService.findOneForTenant(id, user.tenantId);
    }
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(
    @Request() req: AuditRequestContext,
    @Param('id') id: string,
    @Body() updateTenantDto: UpdateTenantDto,
  ) {
    return this.tenantsService.update(id, updateTenantDto, {
      userId: req.user?.userId ?? '',
      ip: req.ip ?? 'unknown',
      userAgent: req.headers?.['user-agent'] ?? 'unknown',
    });
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }
}
