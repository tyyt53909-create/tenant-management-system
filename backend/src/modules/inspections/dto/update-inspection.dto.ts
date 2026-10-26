import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { InspectionStatus } from '@prisma/client';
import { CreateInspectionDto } from './create-inspection.dto.js';

export class UpdateInspectionDto extends PartialType(CreateInspectionDto) {
  @IsEnum(InspectionStatus)
  @IsOptional()
  status?: InspectionStatus;

  @IsString()
  @IsOptional()
  checkoutRecordId?: string;
}
