import { IsNumber, IsString, IsDateString, IsOptional, Min, IsArray, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class SingleMeterReadingItemDto {
  @IsString({ message: 'meterId 必须为字符串' })
  meterId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: '当前读数必须为数字（最多两位小数）' })
  @Min(0, { message: '当前读数不能为负数' })
  currentReading: number;

  @IsDateString({}, { message: '读数时间格式不正确' })
  @IsOptional()
  readingTime?: string;

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
