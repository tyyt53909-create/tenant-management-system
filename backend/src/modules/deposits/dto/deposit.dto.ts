import { IsInt, IsNotEmpty, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class DepositAmountDto {
  @IsInt({ message: '金额必须为整数（分）' })
  @Min(1, { message: '金额必须大于 0' })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: '原因不能为空' })
  @MaxLength(200)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class TransferDepositDto {
  @IsString()
  @IsNotEmpty({ message: '目标合同不能为空' })
  toContractId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
