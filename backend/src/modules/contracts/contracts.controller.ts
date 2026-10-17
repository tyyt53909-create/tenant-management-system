import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ContractsService } from './contracts.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { QueryContractsDto } from './dto/query-contracts.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createContractDto: CreateContractDto) {
    return this.contractsService.create(createContractDto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryContractsDto) {
    return this.contractsService.findAll(query);
  }

  // 租客查看自己的合同
  @Get('my')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  findMy(@CurrentUser() userParam: CurrentUserParam, @Query() query: QueryContractsDto) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId || user.userId || '';
      return this.contractsService.findByTenant(tenantId, query);
    }
    return this.contractsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  findOne(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId || user.userId || '';
      return this.contractsService.findOneForTenant(id, tenantId);
    }
    return this.contractsService.findOne(id);
  }

  // 续签：复制原合同生成新草稿并关联 renewedFromId
  @Post(':id/renew')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  renew(@Param('id') id: string, @Body() renewContractDto: RenewContractDto) {
    return this.contractsService.renew(id, renewContractDto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateContractDto: UpdateContractDto) {
    return this.contractsService.update(id, updateContractDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.contractsService.remove(id);
  }
}
