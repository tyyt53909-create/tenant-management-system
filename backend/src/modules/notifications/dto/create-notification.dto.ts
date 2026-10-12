import { IsString, IsNotEmpty, IsEnum, IsOptional, IsObject, MaxLength } from 'class-validator';

export enum NotificationPriority {
  NORMAL = 'NORMAL',
  URGENT = 'URGENT',
}

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty({ message: '接收用户ID不能为空' })
  userId: string;

  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题最多200字符' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: '正文不能为空' })
  body: string;

  @IsEnum(NotificationPriority, { message: '优先级必须为 NORMAL 或 URGENT' })
  @IsOptional()
  priority?: NotificationPriority;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;

  @IsOptional()
  expiredAt?: string;
}
