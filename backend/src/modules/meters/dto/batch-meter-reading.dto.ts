import { IsNumber, IsString, IsDateString, IsOptional, IsBoolean, Min, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class SingleMeterReadingItemDto {
  @IsString({ message: 'meterId 必须为字符串' })
  meterId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: '当前读数必须为数字（最多两位小数）' })
  @Min(0, { message: '当前读数不能为负数' })
  currentReading: number;

  /** 读数时间（缺省为当前时间） */
  @IsDateString({}, { message: '读数时间格式不正确' })
  @IsOptional()
  readingTime?: string;

  /** 采集来源：手工录入 MANUAL 或 智能设备上报 DEVICE */
  @IsEnum(['MANUAL', 'DEVICE'], { message: '采集来源必须为 MANUAL 或 DEVICE' })
  @IsOptional()
  source?: 'MANUAL' | 'DEVICE';

  /** 是否作为初始底数登记（不计费） */
  @IsBoolean()
  @IsOptional()
  isInitial?: boolean;

  /** 是否在录入时自动扣费结算 */
  @IsBoolean()
  @IsOptional()
  autoSettle?: boolean;

  /** 设备消息幂等键 */
  @IsString()
  @IsOptional()
  messageId?: string;

  /** 允许表计回零/换表 */
  @IsBoolean()
  @IsOptional()
  allowRollover?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class BatchMeterReadingsDto {
  @IsArray({ message: 'readings 必须为数组' })
  @ValidateNested({ each: true })
  @Type(() => SingleMeterReadingItemDto)
  readings: SingleMeterReadingItemDto[];
}

export class QueryBatchSheetDto {
  @IsString()
  @IsOptional()
  buildingId?: string;

  @IsString()
  @IsOptional()
  meterType?: 'ELECTRICITY' | 'WATER' | 'GAS';

  @IsOptional()
  floor?: number;
}
