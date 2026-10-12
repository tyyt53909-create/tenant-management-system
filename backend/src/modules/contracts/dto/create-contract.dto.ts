import { IsString, IsNotEmpty, IsInt, IsEnum, IsDateString, IsOptional, Min, Max } from 'class-validator';

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
  lateFeeRule?: any; // JSON
}
