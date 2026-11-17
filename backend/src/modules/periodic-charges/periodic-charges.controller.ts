import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { BatchMeterReadingsDto } from '../meters/dto/batch-meter-reading.dto.js';
import { ConfirmPeriodicChargeDto, PreviewPeriodicChargeDto } from './periodic-charge.dto.js';
import { PeriodicChargesService } from './periodic-charges.service.js';

@Controller('periodic-charges')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class PeriodicChargesController {
  constructor(private readonly workbench: PeriodicChargesService) {}

  @Post('collect')
  collect(@Body() dto: BatchMeterReadingsDto, @CurrentUser() user: CurrentUserParam) {
    return this.workbench.collect(dto, resolveAuthUser(user).userId);
  }

  @Post('preview')
  preview(@Body() dto: PreviewPeriodicChargeDto, @CurrentUser() user: CurrentUserParam) {
    return this.workbench.preview(dto, resolveAuthUser(user).userId);
  }

  @Get()
  list(@Query('before') before?: string) {
    return this.workbench.list(before);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.workbench.detail(id);
  }

  @Post(':id/recheck')
  recheck(@Param('id') id: string, @Body() dto: ConfirmPeriodicChargeDto) {
    return this.workbench.recheck(id, dto.version);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmPeriodicChargeDto, @CurrentUser() user: CurrentUserParam) {
    return this.workbench.confirm(id, dto.version, resolveAuthUser(user).userId);
  }

  @Post(':id/notifications/retry')
  retryNotices(@Param('id') id: string) {
    return this.workbench.retryNotices(id);
  }
}
