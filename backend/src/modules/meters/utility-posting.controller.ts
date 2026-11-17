import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { MeterBillingService } from './meter-billing.service.js';

export class PreviewUtilityChargeDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) meterId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() settleUntil?: string;
}
export class ConfirmUtilityChargeDto extends PreviewUtilityChargeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiProperty() @IsUUID('4') requestId!: string;
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
}

@Controller('utility-charges')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UtilityPostingController {
  constructor(private readonly billing: MeterBillingService) {}

  @Post('preview')
  preview(@Body() dto: PreviewUtilityChargeDto) { return this.billing.previewCharge(dto.meterId, dto.settleUntil); }

  @Post('confirm')
  confirm(@Body() dto: ConfirmUtilityChargeDto, @CurrentUser() user: CurrentUserParam) {
    return this.billing.confirmCharge(dto.meterId, dto, resolveAuthUser(user).userId);
  }

  @Get(':id')
  charge(@Param('id') id: string) { return this.billing.charge(id); }
}
