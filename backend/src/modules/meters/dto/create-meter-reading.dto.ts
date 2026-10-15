import { IsNumber, IsString, IsDateString, IsOptional, IsBoolean, IsEnum, Min } from 'class-validator';

/**
 * 水電讀數登記（docs/02-数据模型.md §2.14）
 * - previousReading / usage / readBy 由服务端计算填充
 * - 支持初始底数标记（isInitial）、采集/结算拆分（autoSettle）以及设备消息去重（messageId）
 */
export class CreateMeterReadingDto {
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

  /** 是否作为初始底数登记（不计费，作为后续起步值） */
  @IsBoolean()
  @IsOptional()
  isInitial?: boolean;

  /** 是否在录入时自动结算扣费；为 false 时仅采集记录，后续统一周期结算 */
  @IsBoolean()
  @IsOptional()
  autoSettle?: boolean;

  /** 设备消息幂等唯一键（用于设备重试与防重） */
  @IsString()
  @IsOptional()
  messageId?: string;

  /** 允许表计回零翻转/换表 */
  @IsBoolean()
  @IsOptional()
  allowRollover?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}
