import { IsString, IsNotEmpty, IsEnum, IsInt, IsOptional, IsDateString, Min } from 'class-validator';

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

  @IsInt()
  @Min(0)
  unitPrice: number; // 分/度

  @IsDateString()
  priceEffectiveDate: string;
}
