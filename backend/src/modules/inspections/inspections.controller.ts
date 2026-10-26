import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InspectionsService } from './inspections.service.js';
import { CreateInspectionDto } from './dto/create-inspection.dto.js';
import { UpdateInspectionDto } from './dto/update-inspection.dto.js';
import { QueryInspectionsDto } from './dto/query-inspections.dto.js';
import { ConfirmInspectionDto } from './dto/confirm-inspection.dto.js';
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

@Controller('inspections')
@UseGuards(JwtAuthGuard)
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Get('template-items')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getTemplateItems() {
    return this.inspectionsService.getTemplateItems();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(
    @Body() dto: CreateInspectionDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.inspectionsService.create(dto, user.userId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryInspectionsDto) {
    return this.inspectionsService.findAll(query);
  }

  @Get('my')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  findMy(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryInspectionsDto,
  ) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.inspectionsService.findByTenant(tenantId, query);
    }
    return this.inspectionsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  findOne(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
  ) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      return this.inspectionsService.findOneForTenant(id, user.tenantId);
    }
    return this.inspectionsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateInspectionDto) {
    return this.inspectionsService.update(id, dto);
  }

  @Post(':id/confirm')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmInspectionDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    const isTenant = user.role === 'TENANT';
    return this.inspectionsService.confirm(id, dto, user.tenantId, isTenant);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.inspectionsService.remove(id);
  }
}
