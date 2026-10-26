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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ContractsService } from './contracts.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { QueryContractsDto } from './dto/query-contracts.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { AddCoTenantDto } from './dto/co-tenant.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import {
  CurrentUser,
  resolveAuthUser,
  type CurrentUserParam,
} from '../../common/decorators/current-user.decorator.js';

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
      const tenantId = user.tenantId ?? '';
      return this.contractsService.findByTenant(tenantId, query);
    }
    return this.contractsService.findAll(query);
  }

  /**
   * 第三方电子签 Webhook 回调（公网免登录）
   */
  @Post('sign/callback')
  @Public()
  handleSignCallback(@Body() payload: any) {
    return this.contractsService.handleSignCallback(payload);
  }

  @Get(':id')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  findOne(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.contractsService.findOneForTenant(id, tenantId);
    }
    return this.contractsService.findOne(id);
  }

  /**
   * 下载规范租赁合同 PDF 文档
   */
  @Get(':id/pdf')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.contract.read')
  async downloadPdf(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
    @Res() res: Response,
  ) {
    const user = resolveAuthUser(userParam);
    const pdfBuffer = await this.contractsService.generatePdf(
      id,
      user.tenantId,
      user.role,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="contract-${id}.pdf"`);
    res.send(pdfBuffer);
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

  /**
   * 为已有合同添加共同承租人
   */
  @Post(':id/co-tenants')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  addCoTenant(@Param('id') id: string, @Body() dto: AddCoTenantDto) {
    return this.contractsService.addCoTenant(id, dto);
  }

  /**
   * 移除共同承租人
   */
  @Delete(':id/co-tenants/:coTenantId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  removeCoTenant(
    @Param('id') id: string,
    @Param('coTenantId') coTenantId: string,
  ) {
    return this.contractsService.removeCoTenant(id, coTenantId);
  }

  /**
   * 发起电子签约流程（DEC-05）
   */
  @Post(':id/sign/initiate')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  initiateSignFlow(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.contractsService.initiateSignFlow(id, user.userId);
  }

  /**
   * 查询电子签约状态与各方签署进度
   */
  @Get(':id/sign/status')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.contract.read')
  getSignStatus(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.contractsService.getSignStatus(id, user.tenantId, user.role);
  }

  /**
   * 模拟完成签署（测试/沙箱环境）
   */
  @Post(':id/sign/mock-complete')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  mockCompleteSign(@Param('id') id: string) {
    return this.contractsService.mockCompleteSign(id);
  }
}
