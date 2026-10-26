import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsEnum,
  IsDateString,
  IsOptional,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateCoTenantDto } from './co-tenant.dto.js';

enum PaymentCycle {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  ANNUAL = 'ANNUAL',
}

export class CreateContractDto {
  @IsString()
  @IsNotEmpty()
  buildingId: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsInt()
  @Min(0)
  rentAmount: number; // 分

  @IsInt()
  @Min(0)
  depositAmount: number; // 分

  @IsEnum(PaymentCycle)
  paymentCycle: PaymentCycle;

  @IsInt()
  @Min(1)
  @Max(31)
  paymentDay: number; // 每月几号付款

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  lateFeeRule?: Record<string, unknown>; // JSON

  @IsString()
  @IsOptional()
  templateId?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateCoTenantDto)
  coTenants?: CreateCoTenantDto[];
}
