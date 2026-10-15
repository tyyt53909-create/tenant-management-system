import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { QueryTenantsDto } from './dto/query-tenants.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

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

  // 租客详情：管理者看全部；租客仅可看自己（越权按 404 处理）
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TENANT')
  findOne(@Request() req: any, @Param('id') id: string) {
    if (req.user?.role === 'TENANT') {
      return this.tenantsService.findOneForTenant(id, req.user?.tenantId);
    }
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantsService.update(id, updateTenantDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }
}
