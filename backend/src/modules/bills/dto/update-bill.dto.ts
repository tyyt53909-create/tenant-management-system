import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateBillDto } from './create-bill.dto.js';

enum BillStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export class UpdateBillDto extends PartialType(CreateBillDto) {
  /** 只允许取消。实收和结清状态由收款、滞纳金和冲正计算。 */
  @IsEnum(BillStatus)
  @IsOptional()
  status?: BillStatus;
}
