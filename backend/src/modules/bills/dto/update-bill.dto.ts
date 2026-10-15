import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CreateBillDto } from './create-bill.dto.js';

enum BillStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export class UpdateBillDto extends PartialType(CreateBillDto) {
  @IsEnum(BillStatus)
  @IsOptional()
  status?: BillStatus;

  @IsInt()
  @Min(0)
  @IsOptional()
  paidAmount?: number;
}
