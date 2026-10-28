import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CleaningTaskStatus, CleaningTaskType } from '@prisma/client';

export class QueryCleaningTasksDto {
  @IsOptional()
  @IsEnum(CleaningTaskStatus, { message: '保洁状态参数不合法' })
  status?: CleaningTaskStatus;

  @IsOptional()
  @IsEnum(CleaningTaskType, { message: '保洁类型参数不合法' })
  type?: CleaningTaskType;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  cleanerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
