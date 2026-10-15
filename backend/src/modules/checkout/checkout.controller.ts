import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, Res } from '@nestjs/common';
import { CheckoutService } from './checkout.service.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';
import { UpdateCheckoutDto } from './dto/update-checkout.dto.js';
import { QueryCheckoutsDto } from './dto/query-checkouts.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';

@Controller('checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createCheckoutDto: CreateCheckoutDto) {
    return this.checkoutService.create(createCheckoutDto);
  }

  // 退租记录 CSV 导出（仅管理者）
  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async exportCheckouts(@Query() query: any, @Res({ passthrough: true }) res: any) {
    const csv = await this.checkoutService.exportCheckouts(query);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="checkout-export-${dateStr}.csv"`);
    return csv;
  }

  // 退租记录列表：管理者看全部，租客仅自己的记录（保洁无权限，docs/03-权限矩阵.md §3.7）
  @Get()
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.checkout.read')
  findAll(@Request() req: any, @Query() query: QueryCheckoutsDto) {
    if (req.user?.role === 'TENANT') {
      return this.checkoutService.findByTenant(req.user?.tenantId, query);
    }
    return this.checkoutService.findAll(query);
  }

  // 电子退租结算单据（租客只能看自己的单据）
  @Get(':id/voucher')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.checkout.read')
  getVoucher(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.role === 'TENANT' ? req.user?.tenantId : undefined;
    return this.checkoutService.getVoucher(id, tenantId);
  }

  // 退租记录详情：租客仅自己的记录（越权按 404 处理）
  @Get(':id')
  @UseGuards(RolesGuard, CapabilityGuard)
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.checkout.read')
  findOne(@Request() req: any, @Param('id') id: string) {
    if (req.user?.role === 'TENANT') {
      return this.checkoutService.findOneForTenant(id, req.user?.tenantId);
    }
    return this.checkoutService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateCheckoutDto: UpdateCheckoutDto) {
    return this.checkoutService.update(id, updateCheckoutDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.checkoutService.remove(id);
  }
}
