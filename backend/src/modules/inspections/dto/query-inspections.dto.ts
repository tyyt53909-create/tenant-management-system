import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { InspectionType, InspectionStatus } from '@prisma/client';

export class QueryInspectionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(InspectionType)
  type?: InspectionType;

  @IsOptional()
  @IsEnum(InspectionStatus)
  status?: InspectionStatus;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}
