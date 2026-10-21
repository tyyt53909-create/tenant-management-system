import { IsOptional, IsInt, IsEnum, IsString, MaxLength, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum WorkbenchView {
  /** 公共池 + 直接指派给我的待接工单 */
  POOL = 'pool',
  /** 我已接单、处理中的工单 */
  ACTIVE = 'active',
  /** 我已完成的工单 */
  DONE = 'done',
}

export enum WorkbenchPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  URGENT = 'URGENT',
}

export enum WorkbenchCategory {
  PLUMBING = 'PLUMBING',
  ELECTRICAL = 'ELECTRICAL',
  APPLIANCE = 'APPLIANCE',
  FURNITURE = 'FURNITURE',
  DOOR_WINDOW = 'DOOR_WINDOW',
  OTHER = 'OTHER',
}

export class QueryWorkbenchDto {
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

  @IsEnum(WorkbenchView)
  @IsOptional()
  view?: WorkbenchView = WorkbenchView.POOL;

  @IsEnum(WorkbenchPriority)
  @IsOptional()
  priority?: WorkbenchPriority;

  @IsEnum(WorkbenchCategory)
  @IsOptional()
  category?: WorkbenchCategory;

  /** 搜索标题、描述或房间号 */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(50)
  @IsOptional()
  keyword?: string;
}
