import { IsOptional, IsInt, IsString, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum RoomStatus {
  VACANT = 'VACANT',
  OCCUPIED = 'OCCUPIED',
  MAINTENANCE = 'MAINTENANCE',
  RESERVED = 'RESERVED',
}

export enum CleanStatus {
  CLEAN = 'CLEAN',
  PENDING_CLEAN = 'PENDING_CLEAN',
  CLEANING = 'CLEANING',
}

export class QueryRoomsDto {
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

  @IsEnum(RoomStatus, { message: '房态必须为 VACANT, OCCUPIED, MAINTENANCE 或 RESERVED' })
  @IsOptional()
  status?: RoomStatus;

  @IsEnum(CleanStatus, { message: '清洁状态必须为 CLEAN, PENDING_CLEAN 或 CLEANING' })
  @IsOptional()
  cleanStatus?: CleanStatus;

  @IsString({ message: '楼栋ID格式错误' })
  @IsOptional()
  buildingId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  minRent?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  maxRent?: number;
}
