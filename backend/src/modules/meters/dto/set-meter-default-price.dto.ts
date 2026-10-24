import { IsDateString, IsEnum, IsInt, Min } from 'class-validator';
import { MeterType } from '@prisma/client';

/** 表类型默认价（T276）：写入 MeterPriceHistory 时 meterId 为空。 */
export class SetMeterDefaultPriceDto {
  @IsEnum(MeterType)
  meterType: MeterType;

  @IsInt()
  @Min(0)
  unitPrice: number;

  @IsDateString()
  effectiveDate: string;
}
