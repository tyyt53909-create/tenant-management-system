import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RunReconciliationDto {
  /** 对账日期，格式为 YYYY-MM-DD */
  @IsString({ message: '对账日期不能为空' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '对账日期格式必须为 YYYY-MM-DD' })
  billDate: string;
}

export class QueryReconciliationBatchesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export enum DiscrepancyResolveAction {
  AUTO_SYNC = 'AUTO_SYNC',
  MANUAL_RESOLVE = 'MANUAL_RESOLVE',
}

export class ResolveDiscrepancyDto {
  @IsEnum(DiscrepancyResolveAction, { message: '处理动作必须为 AUTO_SYNC 或 MANUAL_RESOLVE' })
  action: DiscrepancyResolveAction;

  @IsOptional()
  @IsString()
  notes?: string;
}
