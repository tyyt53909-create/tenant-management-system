import { IsOptional, IsEnum, IsDateString, IsString } from 'class-validator';

enum StatisticsPeriod {
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
  CUSTOM = 'CUSTOM',
}

enum StatisticsDimension {
  BUILDING = 'BUILDING',
  FLOOR = 'FLOOR',
}

export class QueryStatisticsDto {
  /** 时间维度；默认当月 */
  @IsEnum(StatisticsPeriod)
  @IsOptional()
  period?: StatisticsPeriod = StatisticsPeriod.MONTH;

  /** 空间维度；默认整楼 */
  @IsEnum(StatisticsDimension)
  @IsOptional()
  dimension?: StatisticsDimension = StatisticsDimension.BUILDING;

  /** period=CUSTOM 时必填 */
  @IsDateString()
  @IsOptional()
  startDate?: string;

  /** period=CUSTOM 时必填 */
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  buildingId?: string;
}
