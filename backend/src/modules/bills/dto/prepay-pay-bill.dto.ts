import { IsInt, Min, IsString, IsOptional } from 'class-validator';

export class PrepayPayBillDto {
  @IsInt({ message: '抵扣金额必须为整数（单位：分）' })
  @Min(1, { message: '抵扣金额必须大于 0' })
  @IsOptional()
  amount?: number;

  @IsString({ message: '幂等键必须为字符串' })
  @IsOptional()
  idempotencyKey?: string;
}
