import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum BillStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export enum BillType {
  RENT = 'RENT',
  UTILITY = 'UTILITY',
  OTHER = 'OTHER',
}

export class QueryBillsDto {
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

  @IsEnum(BillStatus)
  @IsOptional()
  status?: BillStatus | `${BillStatus}`;

  @IsEnum(BillType)
  @IsOptional()
  billType?: BillType | `${BillType}`;

  @IsString()
  @IsOptional()
  contractId?: string;

  @IsString()
  @IsOptional()
  buildingId?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
