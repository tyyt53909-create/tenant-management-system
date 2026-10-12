import { IsNumber, IsString, IsDateString, IsOptional, Min } from 'class-validator';

/**
 * 水電讀數登記（docs/02-数据模型.md §2.14）
 * - previousReading / usage / source / readBy 由服务端计算填充
 * - 登记后自动按「當前單價 × 用量」從預付帳戶扣費；餘額不足時差额生成 UTILITY 補缴帳單
 */
export class CreateMeterReadingDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '当前读数必须为数字（最多两位小数）' })
  @Min(0, { message: '当前读数不能为负数' })
  currentReading: number;

  /** 读数时间（缺省为当前时间） */
  @IsDateString({}, { message: '读数时间格式不正确' })
  @IsOptional()
  readingTime?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
