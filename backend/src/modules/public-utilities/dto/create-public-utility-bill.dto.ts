import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePublicUtilityBillDto {
  /** 不传时用 DEFAULT_BUILDING_ID */
  @IsString()
  @IsOptional()
  @MaxLength(40)
  buildingId?: string;

  /** ELECTRICITY / WATER / GAS */
  @IsString()
  @Matches(/^(ELECTRICITY|WATER|GAS)$/, { message: 'meterType 只能是 ELECTRICITY/WATER/GAS' })
  meterType: 'ELECTRICITY' | 'WATER' | 'GAS';

  /** 计费月 YYYY-MM */
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period 需为 YYYY-MM' })
  period: string;

  /** 公共表 ID（可选）：给出时按该表当月用量 × 单价自动算总额 */
  @IsString()
  @IsOptional()
  meterId?: string;

  /** 单价（分/度或吨），不传时取表上的单价 */
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  unitPrice?: number;

  /** 直接录入总额（分）；与 meterId 二选一 */
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  totalAmount?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
