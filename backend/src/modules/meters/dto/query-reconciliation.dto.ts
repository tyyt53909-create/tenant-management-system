import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class QueryReconciliationDto {
  /** 账期 YYYY-MM；不传时默认上个月 */
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period 需为 YYYY-MM' })
  @IsOptional()
  period?: string;

  @IsString()
  @IsOptional()
  @MaxLength(40)
  buildingId?: string;

  @IsIn(['ELECTRICITY', 'WATER', 'GAS'])
  @IsOptional()
  meterType?: 'ELECTRICITY' | 'WATER' | 'GAS';
}
