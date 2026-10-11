import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateMeterDto } from './create-meter.dto.js';

export class UpdateMeterDto extends PartialType(CreateMeterDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
