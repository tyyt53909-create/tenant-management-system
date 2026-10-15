import { IsString, IsNotEmpty, IsInt, IsEnum, IsDateString, IsOptional, Min } from 'class-validator';

export enum BillType {
  RENT = 'RENT',
  UTILITY = 'UTILITY',
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
  snapshot?: any; // JSON 快照（合同信息）
}
