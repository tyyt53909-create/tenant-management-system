import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, Res } from '@nestjs/common';
import { PrepayService } from './prepay.service.js';
import { CreatePrepayAccountDto } from './dto/create-prepay-account.dto.js';
import { UpdatePrepayAccountDto } from './dto/update-prepay-account.dto.js';
import { QueryPrepayAccountsDto } from './dto/query-prepay-accounts.dto.js';
import { CreatePrepayTransactionDto } from './dto/create-prepay-transaction.dto.js';
import { QueryPrepayTransactionsDto } from './dto/query-prepay-transactions.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';

@Controller('prepay-accounts')
@UseGuards(JwtAuthGuard)
export class PrepayController {
  constructor(private readonly prepayService: PrepayService) {}

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
  findMy(@Request() req: any) {
    if (req.user.role === 'TENANT') {
      return this.prepayService.findByTenant(req.user.tenantId);
    }
    return this.prepayService.findAll({});
  }

  // 管理员：预付交易流水导出（CSV）
  @Get('transactions/export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async exportTransactions(@Query() query: any, @Res({ passthrough: true }) res: any) {
    const csv = await this.prepayService.exportTransactions(query);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prepay-transactions-${dateStr}.csv"`);
    return csv;
  }

  // 租客查看自己的交易记录
  @Get('transactions')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('TENANT', 'ADMIN')
  @RequireCapability('tenant.prepay.read')
  findTransactions(@Request() req: any, @Query() query: QueryPrepayTransactionsDto) {
    if (req.user.role === 'TENANT') {
      return this.prepayService.findTransactionsByTenant(req.user.tenantId, query);
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
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreatePrepayTransactionDto,
  ) {
    return this.prepayService.recordTransaction(id, dto, req.user.userId);
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
