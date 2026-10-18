import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PublicUtilitiesService } from './public-utilities.service.js';
import { CreatePublicUtilityBillDto } from './dto/create-public-utility-bill.dto.js';
import { QueryPublicUtilityBillDto } from './dto/query-public-utility-bill.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

/** 公共水电分摊（T217）：仅管理员；租客只会在自己的 UTILITY 账单里看到结果 */
@Controller('public-utilities')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class PublicUtilitiesController {
  constructor(private readonly service: PublicUtilitiesService) {}

  @Get()
  findAll(@Query() query: QueryPublicUtilityBillDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('preview')
  preview(@Body() dto: CreatePublicUtilityBillDto) {
    return this.service.preview(dto);
  }

  @Post()
  create(@Body() dto: CreatePublicUtilityBillDto, @CurrentUser() userParam: CurrentUserParam, @Req() req: Request) {
    return this.service.create(dto, actorOf(userParam, req));
  }

  @Post(':id/generate-bills')
  generateBills(@Param('id') id: string, @CurrentUser() userParam: CurrentUserParam, @Req() req: Request) {
    return this.service.generateBills(id, actorOf(userParam, req));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() userParam: CurrentUserParam, @Req() req: Request) {
    return this.service.remove(id, actorOf(userParam, req));
  }
}

function actorOf(userParam: CurrentUserParam, req: Request) {
  const user = resolveAuthUser(userParam);
  return {
    userId: user.userId,
    ip: req.ip ?? 'unknown',
    userAgent: (req.headers['user-agent'] as string | undefined) ?? 'unknown',
  };
}
