import { IsOptional, IsInt, IsString, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

enum MaintenanceStatus {
  SUBMITTED = 'SUBMITTED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export class QueryMaintenanceDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsEnum(MaintenanceStatus)
  @IsOptional()
  status?: MaintenanceStatus;

  @IsString()
  @IsOptional()
  roomId?: string;

  @IsString()
  @IsOptional()
  tenantId?: string;
}
