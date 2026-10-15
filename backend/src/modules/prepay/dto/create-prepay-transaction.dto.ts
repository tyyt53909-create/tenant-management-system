import { IsString, IsNotEmpty, IsInt, IsEnum, IsOptional } from 'class-validator';

export enum PrepayTransactionType {
  RECHARGE = 'RECHARGE',
  DEDUCTION = 'DEDUCTION',
  REFUND = 'REFUND',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum RelatedType {
  METER_READING = 'METER_READING',
  CHECKOUT = 'CHECKOUT',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
}

/**
 * 预付账户流水登记（docs/02-数据模型.md §2.12）
 * - RECHARGE / DEDUCTION / REFUND：amount 必须为正数（服务层按类型决定增减方向）
 * - ADJUSTMENT：amount 可正可负（管理员手动修正），不可为 0
 * - 扣费/退款不允许透支（服务层校验，余额不足返回 400）
 */
export class CreatePrepayTransactionDto {
  @IsEnum(PrepayTransactionType, {
    message: '类型必须为 RECHARGE, DEDUCTION, REFUND 或 ADJUSTMENT',
  })
  type: PrepayTransactionType;

  @IsInt({ message: '金额必须为整数（单位：分）' })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: '描述不能为空' })
  description: string;

  @IsString()
  @IsOptional()
  relatedId?: string;

  @IsEnum(RelatedType, {
    message: '关联类型必须为 METER_READING, CHECKOUT 或 MANUAL_ADJUSTMENT',
  })
  @IsOptional()
  relatedType?: RelatedType;
}
