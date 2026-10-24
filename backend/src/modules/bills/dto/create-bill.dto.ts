import { IsString, IsNotEmpty, IsInt, IsEnum, IsDateString, IsOptional, Min } from 'class-validator';

export enum BillType {
  RENT = 'RENT',
  UTILITY = 'UTILITY',
  DEPOSIT = 'DEPOSIT',
  OTHER = 'OTHER',
}
export class CreateBillDto {
  @IsString()
  @IsNotEmpty()
  contractId: string;

  @IsEnum(BillType)
  billType: BillType;

  @IsString()
  @IsNotEmpty()
  period: string; // 例如 "2026-10"

  @IsInt()
  @Min(0)
  amount: number; // 分

  @IsDateString()
  dueDate: string;

  @IsOptional()
  snapshot?: Record<string, unknown>; // JSON 快照（合同信息）
}
