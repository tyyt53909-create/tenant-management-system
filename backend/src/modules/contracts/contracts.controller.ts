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
import { ContractRenewalsService } from './contract-renewals.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { QueryContractsDto } from './dto/query-contracts.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { AddCoTenantDto } from './dto/co-tenant.dto.js';
import {
  SubmitRenewalIntentDto,
  QueryRenewalIntentsDto,
} from './dto/submit-renewal-intent.dto.js';
import {
  CreateRenewalOfferDto,
  RespondRenewalOfferDto,
  QueryRenewalOffersDto,
} from './dto/renewal-offer.dto.js';
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
  constructor(
    private readonly contractsService: ContractsService,
    private readonly renewalsService: ContractRenewalsService,
  ) {}

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
   * 查询即将到期的合同（LSE-04 / T301）
   */
  @Get('expiring')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findExpiring(@Query('days') days?: string) {
    const daysAhead = days ? Math.max(1, Math.min(180, parseInt(days, 10))) : 30;
    return this.renewalsService.findExpiringContracts(daysAhead);
  }

  /**
   * 查询到期滞留（Holdover）未退租未续约合同（ISS-20 / T301）
   */
  @Get('holdover')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findHoldover() {
    return this.renewalsService.findHoldoverContracts();
  }

  /**
   * 管理员查询全部续约意向
   */
  @Get('renewal-intents')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAllRenewalIntents(@Query() query: QueryRenewalIntentsDto) {
    return this.renewalsService.findAllRenewalIntents(query);
  }

  /**
   * 管理员查询全部续约报价
   */
  @Get('renewal-offers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAllRenewalOffers(@Query() query: QueryRenewalOffersDto) {
    return this.renewalsService.findAllRenewalOffers(query);
  }

  /**
   * 租客查询本人的续约报价
   */
  @Get('renewal-offers/my')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  findMyRenewalOffers(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryRenewalOffersDto,
  ) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.renewalsService.findMyRenewalOffers(tenantId, query);
    }
    return this.renewalsService.findAllRenewalOffers(query);
  }

  /**
   * 租客接受或拒绝续约报价方案
   */
  @Post('renewal-offers/:offerId/respond')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  respondRenewalOffer(
    @Param('offerId') offerId: string,
    @Body() dto: RespondRenewalOfferDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.tenantId ?? '';
    return this.renewalsService.respondRenewalOffer(offerId, tenantId, dto);
  }

  /**
   * 管理端撤回续约报价
   */
  @Post('renewal-offers/:offerId/cancel')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  cancelRenewalOffer(@Param('offerId') offerId: string) {
    return this.renewalsService.cancelRenewalOffer(offerId);
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
   * 租客登记或更新本人的续约意向（LSE-04 / T301）
   */
  @Post(':id/renewal-intent')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  submitRenewalIntent(
    @Param('id') id: string,
    @Body() dto: SubmitRenewalIntentDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.tenantId ?? '';
    return this.renewalsService.submitRenewalIntent(id, tenantId, dto);
  }

  /**
   * 查询指定合同的续约意向
   */
  @Get(':id/renewal-intent')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.contract.read')
  getRenewalIntent(
    @Param('id') id: string,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    const isTenant = user.role === 'TENANT';
    return this.renewalsService.getRenewalIntent(id, user.tenantId, isTenant);
  }

  /**
   * 管理员发起针对该合同的续约报价
   */
  @Post(':id/renewal-offers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createRenewalOffer(
    @Param('id') id: string,
    @Body() dto: CreateRenewalOfferDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.renewalsService.createRenewalOffer(id, user.userId, dto);
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
