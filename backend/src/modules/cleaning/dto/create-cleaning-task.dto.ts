import { IsEnum, IsNotEmpty, IsOptional, IsString, IsArray } from 'class-validator';
import { CleaningTaskType } from '@prisma/client';

export class CreateCleaningTaskDto {
  @IsNotEmpty({ message: '房间ID不能为空' })
  @IsString({ message: '房间ID必须是字符串' })
  roomId: string;

  @IsOptional()
  @IsEnum(CleaningTaskType, { message: '不支持的保洁类型' })
  type?: CleaningTaskType;

  @IsOptional()
  @IsString({ message: '保洁员ID必须是字符串' })
  cleanerId?: string;

  @IsOptional()
  @IsArray({ message: '清洁前照片必须是数组' })
  beforePhotos?: string[];

  @IsOptional()
  @IsString({ message: '保洁说明必须是字符串' })
  notes?: string;
}
