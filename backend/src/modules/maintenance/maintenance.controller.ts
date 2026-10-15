import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';

@Controller('maintenance')
@UseGuards(JwtAuthGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post()
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.maintenance.create')
  create(@Request() req: any, @Body() createMaintenanceDto: CreateMaintenanceDto) {
    return this.maintenanceService.create(createMaintenanceDto, req.user);
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
  findMy(@Request() req: any, @Query() query: QueryMaintenanceDto) {
    return this.maintenanceService.findByTenant(req.user.tenantId, query);
  }

  @Get(':id')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.maintenance.read')
  findOne(@Request() req: any, @Param('id') id: string) {
    if (req.user.role === 'TENANT') {
      return this.maintenanceService.findOneForTenant(id, req.user.tenantId);
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
