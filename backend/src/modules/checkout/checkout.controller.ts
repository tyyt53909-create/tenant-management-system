import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { CheckoutService } from './checkout.service.js';
import { CreateCheckoutDto } from './dto/create-checkout.dto.js';
import { UpdateCheckoutDto } from './dto/update-checkout.dto.js';
import { QueryCheckoutsDto } from './dto/query-checkouts.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

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

  // 退租记录列表：管理者看全部，租客仅自己的记录（保洁无权限，docs/03-权限矩阵.md §3.7）
  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TENANT')
  findAll(@Request() req: any, @Query() query: QueryCheckoutsDto) {
    if (req.user?.role === 'TENANT') {
      return this.checkoutService.findByTenant(req.user?.tenantId, query);
    }
    return this.checkoutService.findAll(query);
  }

  // 退租记录详情：租客仅自己的记录（越权按 404 处理）
  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TENANT')
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
