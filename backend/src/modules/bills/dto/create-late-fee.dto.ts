import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * 添加 / 确认滞纳金（docs/05-接口规范.md §8.5）
 *
 * - 不传 `confirmedAmount`：仅生成/刷新系统建议值（不生效）
 * - 传 `confirmedAmount`：管理者确认金额（可调整），滞纳金入账生效
 */
export class CreateLateFeeDto {
  /** 管理者确认金额（分），可不等于建议值（允许减免为 0） */
  @IsInt({ message: '确认金额必须为整数（单位：分）' })
  @Min(0, { message: '确认金额不能为负数' })
  @IsOptional()
  confirmedAmount?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
