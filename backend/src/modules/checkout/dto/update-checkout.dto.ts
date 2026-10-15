import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateCheckoutDto } from './create-checkout.dto.js';

enum CheckoutStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class UpdateCheckoutDto extends PartialType(CreateCheckoutDto) {
  @IsEnum(CheckoutStatus)
  @IsOptional()
  status?: CheckoutStatus;
}
