import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

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

  /** 只看逾期未缴清（FIN-04 / T272）；`status=OVERDUE` 仍兼容但会映射到本参数。 */
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  @IsOptional()
  overdue?: boolean;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
