import { IsOptional, IsInt, IsString, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

enum BillStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

enum BillType {
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
  status?: BillStatus;

  @IsEnum(BillType)
  @IsOptional()
  billType?: BillType;

  @IsString()
  @IsOptional()
  contractId?: string;
}
