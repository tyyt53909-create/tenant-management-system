import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { CancelExpenseDto, CorrectExpenseDto, CreateExpenseDto, QueryExpensesDto, RecordExpensePaymentDto } from './dto/expense.dto.js';
import { ExpensesService } from './expenses.service.js';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'FINANCIAL')
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}
  @Get('buildings') buildings(@CurrentUser() user: CurrentUserParam) { return this.service.buildings(resolveAuthUser(user)); }
  @Get() list(@Query() query: QueryExpensesDto, @CurrentUser() user: CurrentUserParam) { return this.service.list(query, resolveAuthUser(user)); }
  @Post() create(@Body() dto: CreateExpenseDto, @CurrentUser() user: CurrentUserParam) { return this.service.create(dto, resolveAuthUser(user)); }
  @Patch(':id') correct(@Param('id') id: string, @Body() dto: CorrectExpenseDto, @CurrentUser() user: CurrentUserParam, @Req() req: Request) { return this.service.correct(id, dto, actor(user, req)); }
  @Post(':id/cancel') cancel(@Param('id') id: string, @Body() dto: CancelExpenseDto, @CurrentUser() user: CurrentUserParam, @Req() req: Request) { return this.service.cancel(id, dto, actor(user, req)); }
  @Post(':id/payments') pay(@Param('id') id: string, @Body() dto: RecordExpensePaymentDto, @CurrentUser() user: CurrentUserParam) { return this.service.pay(id, dto, resolveAuthUser(user)); }
}

function actor(user: CurrentUserParam, req: Request) { return { ...resolveAuthUser(user), ip: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] ?? 'unknown' }; }
