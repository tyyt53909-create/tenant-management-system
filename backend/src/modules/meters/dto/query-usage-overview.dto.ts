import { IsOptional, IsString, Matches } from 'class-validator';

export class QueryUsageOverviewDto {
  @IsOptional()
  @IsString()
  buildingId?: string;

  /**
   * 目标月份，格式为 YYYY-MM
   * 若未指定则默认为当前月份
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month 格式必须为 YYYY-MM（例如 2026-10）',
  })
  month?: string;
}
