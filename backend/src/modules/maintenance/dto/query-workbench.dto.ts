import { IsOptional, IsInt, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum WorkbenchView {
  /** 公共池 + 直接指派给我的待接工单 */
  POOL = 'pool',
  /** 我已接单、处理中的工单 */
  ACTIVE = 'active',
  /** 我已完成的工单 */
  DONE = 'done',
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
}
