import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('maintenance')
@UseGuards(JwtAuthGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post()
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.maintenance.create')
  create(@CurrentUser() userParam: CurrentUserParam, @Body() createMaintenanceDto: CreateMaintenanceDto) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.create(createMaintenanceDto, user);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryMaintenanceDto) {
    return this.maintenanceService.findAll(query);
  }

  // 租客查看自己的报修（必须声明在 :id 之前）
  @Get('my')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT')
  @RequireCapability('tenant.maintenance.read')
  findMy(@CurrentUser() userParam: CurrentUserParam, @Query() query: QueryMaintenanceDto) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.tenantId ?? '';
    return this.maintenanceService.findByTenant(tenantId, query);
  }

  @Get(':id')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.maintenance.read')
  findOne(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.maintenanceService.findOneForTenant(id, tenantId);
    }
    return this.maintenanceService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateMaintenanceDto: UpdateMaintenanceDto) {
    return this.maintenanceService.update(id, updateMaintenanceDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.maintenanceService.remove(id);
  }
}
