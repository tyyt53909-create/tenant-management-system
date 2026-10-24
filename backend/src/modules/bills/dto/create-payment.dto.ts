import { IsString, IsInt, IsEnum, IsDateString, IsOptional, Min, MaxLength } from 'class-validator';

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  WECHAT = 'WECHAT',
  ALIPAY = 'ALIPAY',
  OTHER = 'OTHER',
}

/**
 * 登记收款（docs/04-状态机.md §3.4）
 */
export class CreatePaymentDto {
  @IsInt({ message: '收款金额必须为整数（单位：分）' })
  @Min(1, { message: '收款金额必须大于 0' })
  amount: number;

  @IsEnum(PaymentMethod, {
    message: '收款方式必须为 CASH, BANK_TRANSFER, WECHAT, ALIPAY 或 OTHER',
  })
  paymentMethod: PaymentMethod;

  /** 交易号（同一账单内幂等，重复登记将被拒绝） */
  @IsString()
  @IsOptional()
  transactionNumber?: string;

  /** 幂等键：同键同账单同金额重放返回原收款（也可用 Idempotency-Key 头） */
  @IsString()
  @IsOptional()
  @MaxLength(128, { message: '幂等键过长' })
  idempotencyKey?: string;

  /** 收款时间（缺省为当前时间） */
  @IsDateString({}, { message: '收款时间格式不正确' })
  @IsOptional()
  paidAt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
