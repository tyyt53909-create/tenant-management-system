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
  /** 管理员指定；租客自助报修时由服务端按其生效合同推导（T138） */
  @IsString()
  @IsOptional()
  roomId?: string;

  /** 管理员指定；租客自助报修时取自登录身份（T138） */
  @IsString()
  @IsOptional()
  tenantId?: string;

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
