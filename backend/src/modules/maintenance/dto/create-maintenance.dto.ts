import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';

enum MaintenanceCategory {
  PLUMBING = 'PLUMBING',
  ELECTRICAL = 'ELECTRICAL',
  APPLIANCE = 'APPLIANCE',
  FURNITURE = 'FURNITURE',
  DOOR_WINDOW = 'DOOR_WINDOW',
  OTHER = 'OTHER',
}

enum MaintenancePriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  URGENT = 'URGENT',
}

export class CreateMaintenanceDto {
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsEnum(MaintenanceCategory)
  category: MaintenanceCategory;

  @IsEnum(MaintenancePriority)
  @IsOptional()
  priority?: MaintenancePriority;
}
