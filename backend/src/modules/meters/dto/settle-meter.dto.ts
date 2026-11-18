import { IsArray, IsOptional, IsDateString, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';

class MeterSettlementOptionsDto {
  /** 结算截止时间（默认当前时间） */
  @IsDateString({}, { message: '截止时间格式不正确' })
  @IsOptional()
  settleUntil?: string;

  /** 结算备注 */
  @IsString()
  @IsOptional()
  notes?: string;
}

export class SettleMeterDto extends MeterSettlementOptionsDto {
  /** 使用预览的 targetReadingId，同时传入同一次预览返回的 settleUntil。 */
  @IsString()
  @IsNotEmpty()
  @ValidateIf((_dto, value) => value !== undefined)
  expectedTargetReadingId?: string;

  /** 同一次预览返回的 lastSettledReading，核对结算底数。 */
  @IsNumber()
  @ValidateIf((_dto, value) => value !== undefined)
  expectedBaselineReading?: number;
}

export class SettleMeterBatchDto extends MeterSettlementOptionsDto {
  /** meterIds 未提供时，仅结算此楼栋的在用表。不能省略两个范围字段。 */
  @IsString()
  @IsNotEmpty()
  @ValidateIf((_dto, value) => value !== undefined)
  buildingId?: string;

  /** 指定表计列表优先；空列表执行零项，不回退到楼栋。 */
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ValidateIf((_dto, value) => value !== undefined)
  meterIds?: string[];
}
