import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { PrepayService } from './prepay.service.js';
import { CreatePrepayAccountDto } from './dto/create-prepay-account.dto.js';
import { UpdatePrepayAccountDto } from './dto/update-prepay-account.dto.js';
import { QueryPrepayAccountsDto } from './dto/query-prepay-accounts.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

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
  findAll(@Query() query: QueryPrepayAccountsDto) {
    return this.prepayService.findAll(query);
  }

  @Get(':id')
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
