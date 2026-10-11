import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateBuildingDto } from './create-building.dto.js';

export class UpdateBuildingDto extends PartialType(CreateBuildingDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
