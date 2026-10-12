import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { BillsService } from './bills.service.js';
import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillDto } from './dto/update-bill.dto.js';
import { QueryBillsDto } from './dto/query-bills.dto.js';
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

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.billsService.remove(id);
  }
}
