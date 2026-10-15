import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';

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

  /**
   * 报修照片路径（先 POST /api/files/upload 取得 url 再提交）。
   * 上限 9 张，与 docs/09-待确认清单.md「报修最多 9 张」一致。
   */
  @IsArray()
  @ArrayMaxSize(9, { message: '报修照片最多 9 张' })
  @IsString({ each: true })
  @MaxLength(500, { each: true, message: '照片路径过长' })
  @IsOptional()
  photos?: string[];
}
