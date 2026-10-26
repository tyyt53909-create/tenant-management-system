import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CreateMaintenanceDto } from './create-maintenance.dto.js';

enum MaintenanceStatus {
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING_CONFIRM = 'PENDING_CONFIRM',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class UpdateMaintenanceDto extends PartialType(CreateMaintenanceDto) {
  @IsEnum(MaintenanceStatus)
  @IsOptional()
  status?: MaintenanceStatus;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsString()
  @IsOptional()
  assignedMaintainerId?: string;

  @IsString()
  @IsOptional()
  resolution?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  laborCost?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  materialCost?: number;

  @IsBoolean()
  @IsOptional()
  tenantFault?: boolean;

  @IsString()
  @IsOptional()
  faultReason?: string;
}
