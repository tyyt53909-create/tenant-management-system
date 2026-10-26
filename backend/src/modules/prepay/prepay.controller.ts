import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrepayService } from './prepay.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { CreatePrepayAccountDto } from './dto/create-prepay-account.dto.js';
import { UpdatePrepayAccountDto } from './dto/update-prepay-account.dto.js';
import { QueryPrepayAccountsDto } from './dto/query-prepay-accounts.dto.js';
import { CreatePrepayTransactionDto } from './dto/create-prepay-transaction.dto.js';
import { QueryPrepayTransactionsDto } from './dto/query-prepay-transactions.dto.js';
import { PrepayRechargeJsapiDto, PrepayRechargeQueryDto } from './dto/wechat-prepay.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('prepay-accounts')
@UseGuards(JwtAuthGuard)
export class PrepayController {
  constructor(
    private readonly prepayService: PrepayService,
    private readonly clock: BusinessClock,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createPrepayAccountDto: CreatePrepayAccountDto) {
    return this.prepayService.create(createPrepayAccountDto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryPrepayAccountsDto) {
    return this.prepayService.findAll(query);
  }

  // 租客查看自己的账户
  @Get('my')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.prepay.read')
  findMy(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.prepayService.findByTenant(tenantId);
    }
    return this.prepayService.findAll({});
  }

  // 租客发起预付线上充值微信 JSAPI 订单 (PAY-04 / T296)
  @Post('my/recharge/wechat-jsapi')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.prepay.read')
  createRechargeJsapi(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: PrepayRechargeJsapiDto,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.tenantId ?? '';
    return this.prepayService.createRechargeJsapiOrder(user.userId, tenantId, dto.amount);
  }

  // 租客主动查单同步预付充值 (PAY-04 / T296)
  @Post('my/recharge/wechat-query')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.prepay.read')
  queryRecharge(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: PrepayRechargeQueryDto,
  ) {
    const user = resolveAuthUser(userParam);
    const tenantId = user.tenantId ?? '';
    return this.prepayService.queryAndSyncRecharge(user.userId, tenantId, dto.outTradeNo);
  }

  // 管理员：手动触发预付自动抵扣批处理 (PAY-04 / T296)
  @Post('auto-deduct')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  autoDeduct() {
    return this.prepayService.autoDeductBills();
  }

  // 管理员：预付交易流水导出（CSV）
  @Get('transactions/export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async exportTransactions(@Query() query: QueryPrepayTransactionsDto, @Res({ passthrough: true }) res: Response) {
    const csv = await this.prepayService.exportTransactions(query);
    const dateStr = this.clock.formatDate().replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prepay-transactions-${dateStr}.csv"`);
    return csv;
  }

  // 租客查看自己的交易记录
  @Get('transactions')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.prepay.read')
  findTransactions(@CurrentUser() userParam: CurrentUserParam, @Query() query: QueryPrepayTransactionsDto) {
    const user = resolveAuthUser(userParam);
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      return this.prepayService.findTransactionsByTenant(tenantId, query);
    }
    // 管理员查看所有交易
    return this.prepayService.findAllTransactions(query);
  }

  // 管理员：账户流水（分页）
  @Get(':id/transactions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAccountTransactions(@Param('id') id: string, @Query() query: QueryPrepayTransactionsDto) {
    return this.prepayService.findAccountTransactions(id, query);
  }

  // 管理员：登记充值/扣费/退款/调整
  @Post(':id/transactions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createTransaction(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: CreatePrepayTransactionDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.prepayService.recordTransaction(id, dto, user.userId);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findOne(@Param('id') id: string) {
    return this.prepayService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updatePrepayAccountDto: UpdatePrepayAccountDto) {
    return this.prepayService.update(id, updatePrepayAccountDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.prepayService.remove(id);
  }
}
