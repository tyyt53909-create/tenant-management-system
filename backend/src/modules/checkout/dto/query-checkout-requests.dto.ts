import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { CheckoutRequestStatus } from '@prisma/client';

export class QueryCheckoutRequestsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(CheckoutRequestStatus)
  status?: CheckoutRequestStatus;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}
