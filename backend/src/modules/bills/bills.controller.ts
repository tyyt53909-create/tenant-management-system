import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, Res } from '@nestjs/common';
import { BillsService } from './bills.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { CreateLateFeeDto } from './dto/create-late-fee.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

@Controller('bills')
@UseGuards(JwtAuthGuard)
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createBillDto: CreateBillDto) {
    return this.billsService.create(createBillDto);
  }

  // 账单 CSV 导出（仅管理者）
  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async exportBills(@Query() query: any, @Res({ passthrough: true }) res: any) {
    const csv = await this.billsService.exportBills(query);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bills-export-${dateStr}.csv"`);
    return csv;
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findAll(@Query() query: QueryBillsDto) {
    return this.billsService.findAll(query);
  }

  // 租客查看自己的账单
  @Get('my')
  @UseGuards(RolesGuard)
  @Roles('TENANT', 'ADMIN')
  findMy(@Request() req: any, @Query() query: QueryBillsDto) {
    // 租客只能查看自己的账单
    if (req.user.role === 'TENANT') {
      return this.billsService.findByTenant(req.user.tenantId, query);
    }
    // 管理员可以看所有
    return this.billsService.findAll(query);
  }

  // 电子收款收据单据
  @Get(':id/receipt')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TENANT')
  getReceipt(@Param('id') id: string) {
    return this.billsService.getReceipt(id);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('TENANT', 'ADMIN')
  findOne(@Request() req: any, @Param('id') id: string) {
    // 租客需要验证是否是自己的账单
    if (req.user.role === 'TENANT') {
      return this.billsService.findOneForTenant(id, req.user.tenantId);
    }
    return this.billsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateBillDto: UpdateBillDto) {
    return this.billsService.update(id, updateBillDto);
  }

  // 登记收款（管理者）
  @Post(':id/payments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  addPayment(@Request() req: any, @Param('id') id: string, @Body() dto: CreatePaymentDto) {
    return this.billsService.addPayment(id, dto, req.user.userId);
  }

  // 账单收款流水（管理者）
  @Get(':id/payments')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findPayments(@Param('id') id: string) {
    return this.billsService.findPayments(id);
  }

  // 添加/确认滞纳金（管理者）：不带 confirmedAmount 生成建议值，带则确认入账
  @Post(':id/late-fees')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  addLateFee(@Request() req: any, @Param('id') id: string, @Body() dto: CreateLateFeeDto) {
    return this.billsService.addLateFee(id, dto, req.user.userId);
  }

  // 滞纳金记录（管理者，含计算过程）
  @Get(':id/late-fees')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  findLateFees(@Param('id') id: string) {
    return this.billsService.findLateFees(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.billsService.remove(id);
  }
}
