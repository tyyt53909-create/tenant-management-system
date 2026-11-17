import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ConfirmUtilityRuleDto, ReviewUtilityRuleDto, UtilityInventoryQueryDto } from './utility-readiness.dto.js';
import { UtilityReadinessService } from './utility-readiness.service.js';

@Controller('utility-readiness')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UtilityReadinessController {
  constructor(private readonly readiness: UtilityReadinessService) {}

  @Get('contracts/:id')
  contract(@Param('id') id: string) { return this.readiness.contract(id); }

  @Get('inventory')
  inventory(@Query() query: UtilityInventoryQueryDto) { return this.readiness.inventory(query); }

  @Post('preview')
  preview(@Body() dto: ReviewUtilityRuleDto) { return this.readiness.preview(dto); }

  @Post('confirm')
  confirm(@Body() dto: ConfirmUtilityRuleDto, @CurrentUser() user: CurrentUserParam) {
    return this.readiness.confirm(dto, resolveAuthUser(user).userId);
  }
}
