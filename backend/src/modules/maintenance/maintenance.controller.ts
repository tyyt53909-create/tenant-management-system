import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';
import { CreateMaintenanceMessageDto } from './dto/create-maintenance-message.dto.js';
import {
  DispatchMaintenanceDto,
  StartMaintenanceDto,
  CompleteMaintenanceDto,
  ConfirmMaintenanceDto,
  TransferExpenseDto,
} from './dto/work-order-actions.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import {
  CurrentUser,
  resolveAuthUser,
  type CurrentUserParam,
} from '../../common/decorators/current-user.decorator.js';

@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post()
  @UseGuards(CapabilityGuard)
  @Roles('TENANT', 'ADMIN', 'PROPERTY_MANAGER')
  @RequireCapability('tenant.maintenance.create')
  create(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() createMaintenanceDto: CreateMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.create(createMaintenanceDto, user);
  }

  @Get()
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  findAll(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.findAll(query, user);
  }

  /** 维修师傅专属端：查看指派给本人的工单（WRK-02 / T303） */
  @Get('assigned')
  @Roles('MAINTAINER', 'ADMIN', 'PROPERTY_MANAGER')
  getAssigned(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.getAssignedWorkOrders(user.userId, query);
  }

  /** SLA 超时与预警工单监控列表（WRK-02 / T303） */
  @Get('sla-alerts')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  getSlaAlerts(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.getSlaAlerts(query, user);
  }

  /** 租客查看自己的报修（必须声明在 :id 之前） */
  @Get('my')
  @UseGuards(CapabilityGuard)
  @Roles('TENANT')
  @RequireCapability('tenant.maintenance.read')
  findMy(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.tenantId ?? '';
    return this.maintenanceService.findByTenant(tenantId, query);
  }

  @Get(':id')
  @UseGuards(CapabilityGuard)
  @Roles('TENANT', 'ADMIN', 'PROPERTY_MANAGER', 'MAINTAINER')
  @RequireCapability('tenant.maintenance.read')
  findOne(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
  ) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.maintenanceService.findOneForTenant(id, tenantId);
    }
    return this.maintenanceService.findOne(id, user);
  }

  @Get(':id/messages')
  @UseGuards(CapabilityGuard)
  @Roles('TENANT', 'ADMIN', 'PROPERTY_MANAGER', 'MAINTAINER')
  @RequireCapability('tenant.maintenance.read')
  findMessages(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.findMessages(id, user);
  }

  @Post(':id/messages')
  @UseGuards(CapabilityGuard)
  @Roles('TENANT', 'ADMIN', 'PROPERTY_MANAGER', 'MAINTAINER')
  @RequireCapability('tenant.maintenance.create')
  addMessage(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: CreateMaintenanceMessageDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.addMessage(id, dto, user);
  }

  /** 派工调度（WRK-02 / T303） */
  @Post(':id/dispatch')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  dispatch(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: DispatchMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.dispatch(id, dto, user);
  }

  /** 维修师傅接单开工（WRK-02 / T303） */
  @Post(':id/start')
  @Roles('MAINTAINER', 'ADMIN', 'PROPERTY_MANAGER')
  startWork(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: StartMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.startWork(id, user, dto);
  }

  /** 维修师傅提报完工说明与用料成本（WRK-02 / T303） */
  @Post(':id/complete')
  @Roles('MAINTAINER', 'ADMIN', 'PROPERTY_MANAGER')
  completeWork(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: CompleteMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.completeWork(id, user, dto);
  }

  /** 租客/管理员验收确认（WRK-02 / T303） */
  @Post(':id/confirm')
  @UseGuards(CapabilityGuard)
  @Roles('TENANT', 'ADMIN', 'PROPERTY_MANAGER')
  @RequireCapability('tenant.maintenance.create')
  confirmWork(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: ConfirmMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.confirmWork(id, user, dto);
  }

  /** 租客过失维修费用转嫁生成账单（WRK-02 / T303） */
  @Post(':id/transfer-expense')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  transferExpense(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: TransferExpenseDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.transferExpense(id, user, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  update(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
    @Body() updateMaintenanceDto: UpdateMaintenanceDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.maintenanceService.update(id, updateMaintenanceDto, user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.maintenanceService.remove(id);
  }
}
