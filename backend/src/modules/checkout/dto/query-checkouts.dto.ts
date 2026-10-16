import { IsOptional, IsInt, IsString, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum CheckoutStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class QueryCheckoutsDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsEnum(CheckoutStatus)
  @IsOptional()
  status?: CheckoutStatus | `${CheckoutStatus}`;

  @IsString()
  @IsOptional()
  contractId?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}
