import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsDateString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 退租结算项类型（与 prisma schema 的 CheckoutItemType 对应） */
export enum CheckoutItemType {
  RENT_REFUND = 'RENT_REFUND',
  DEPOSIT_REFUND = 'DEPOSIT_REFUND',
  DEPOSIT_DEDUCTION = 'DEPOSIT_DEDUCTION',
  UTILITY_REFUND = 'UTILITY_REFUND',
  OTHER_FEE = 'OTHER_FEE',
  OTHER_REFUND = 'OTHER_REFUND',
}

/**
 * 退租结算明细项。
 * 按 docs/09-待确认清单.md「押金扣除」约定，每个扣除项必须有
 * 类别（itemType）、金额（amount）、说明（description）三者缺一不可。
 */
export class CheckoutItemDto {
  @IsEnum(CheckoutItemType, {
    message:
      '结算项类别必须为 RENT_REFUND, DEPOSIT_REFUND, DEPOSIT_DEDUCTION, UTILITY_REFUND, OTHER_FEE 或 OTHER_REFUND',
  })
  itemType: CheckoutItemType;

  @IsString()
  @IsNotEmpty({ message: '结算项说明不能为空' })
  @MaxLength(500, { message: '结算项说明不能超过 500 字' })
  description: string;

  @IsInt({ message: '结算项金额必须为整数（分）' })
  @Min(0, { message: '结算项金额不能为负数' })
  amount: number;

  @IsOptional()
  calculation?: any; // JSON 折算明细

  @IsOptional()
  isAdjusted?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: '调整原因不能超过 500 字' })
  adjustReason?: string;
}

export class CreateCheckoutDto {
  @IsString()
  @IsNotEmpty()
  contractId: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsDateString()
  checkoutDate: string;

  @IsInt()
  @Min(0)
  totalRefund: number; // 分

  @IsString()
  @IsNotEmpty()
  processedBy: string; // 处理人ID

  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * 结算明细（含押金扣除项）。可选但一旦提供，每项必须带类别/金额/说明。
   */
  @IsArray()
  @ArrayMinSize(1, { message: '结算明细至少需要 1 项' })
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  @IsOptional()
  items?: CheckoutItemDto[];
}
