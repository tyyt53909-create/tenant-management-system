import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';
import { QueryWorkbenchDto } from './dto/query-workbench.dto.js';
import { CompleteMaintenanceDto } from './dto/complete-maintenance.dto.js';
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

  // 维修人员工作台（静态路径必须声明在 :id 之前）
  @Get('workbench')
  @UseGuards(RolesGuard)
  @Roles('MAINTENANCE')
  findWorkbench(@CurrentUser() userParam: CurrentUserParam, @Query() query: QueryWorkbenchDto) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.findWorkbench(user.userId, query);
  }

  @Get('workbench/:id')
  @UseGuards(RolesGuard)
  @Roles('MAINTENANCE')
  findWorkbenchOne(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.findOneForWorker(id, user.userId);
  }

  // 管理员派单候选人（静态路径必须声明在 :id 之前）
  @Get('assignees')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAssignees() {
    return this.maintenanceService.findAssignees();
  }

  @Get(':id')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN', 'MAINTENANCE')
  @RequireCapability('tenant.maintenance.read')
  findOne(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.maintenanceService.findOneForTenant(id, tenantId);
    }
    if (user.role === 'MAINTENANCE') {
      return this.maintenanceService.findOneForWorker(id, user.userId);
    }
    return this.maintenanceService.findOne(id);
  }

  // 维修人员接单（先接先得）
  @Patch(':id/claim')
  @UseGuards(RolesGuard)
  @Roles('MAINTENANCE')
  claim(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.claim(id, user.userId);
  }

  // 维修人员提交处理结果
  @Patch(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('MAINTENANCE')
  complete(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: CompleteMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.complete(id, user.userId, dto);
  }

  // 维修人员退回公共池
  @Patch(':id/release')
  @UseGuards(RolesGuard)
  @Roles('MAINTENANCE')
  release(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.release(id, user.userId);
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
