import {
  IsOptional,
  IsInt,
  IsEnum,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

enum PaymentCycle {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  ANNUAL = 'ANNUAL',
}

/**
 * 合同续签（docs/09-待确认清单.md §8「合同续签」）：
 * - 新建一份合同并关联上一份（renewedFromId），保留全部历史
 * - 租金、押金可变
 * - 生成结果为 DRAFT 草稿，由管理者确认后另行生效
 * - 未提供的字段从原合同复制
 */
export class RenewContractDto {
  /** 新合同起始日；默认取原合同到期日次日 */
  @IsDateString()
  @IsOptional()
  startDate?: string;

  /** 新合同到期日；必填（租期长度由管理者决定） */
  @IsDateString()
  endDate: string;

  /** 新月租金（分）；默认沿用原合同 */
  @IsInt()
  @Min(0)
  @IsOptional()
  rentAmount?: number;

  /** 新押金（分）；默认沿用原合同 */
  @IsInt()
  @Min(0)
  @IsOptional()
  depositAmount?: number;

  /** 付款周期；默认沿用原合同 */
  @IsEnum(PaymentCycle)
  @IsOptional()
  paymentCycle?: PaymentCycle;

  /** 每月付款日；默认沿用原合同 */
  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  paymentDay?: number;

  /** 滞纳金规则；默认沿用原合同 */
  @IsOptional()
  lateFeeRule?: Record<string, unknown>;
}
