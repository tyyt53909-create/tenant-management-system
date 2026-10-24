import { IsString, IsNotEmpty, IsEnum, IsInt, IsOptional, IsDateString, IsNumber, Min } from 'class-validator';

enum MeterType {
  ELECTRICITY = 'ELECTRICITY',
  WATER = 'WATER',
  GAS = 'GAS',
}

export class CreateMeterDto {
  @IsString()
  @IsNotEmpty()
  buildingId: string;

  @IsString()
  @IsOptional()
  roomId?: string;

  @IsString()
  @IsOptional()
  publicAreaId?: string;

  @IsEnum(MeterType)
  meterType: MeterType;

  @IsString()
  @IsNotEmpty()
  meterNumber: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPrice?: number; // 分/度；未传时使用设置中心的类型默认价（T276）

  @IsDateString()
  priceEffectiveDate: string;

  /** 设备绑定初始底数（非必填，填入时不计费并作为后续起步底数） */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  initialReading?: number;
}
