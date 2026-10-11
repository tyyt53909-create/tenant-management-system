import { IsOptional, IsInt, IsUUID, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

enum RoomStatus {
  VACANT = 'VACANT',
  OCCUPIED = 'OCCUPIED',
  MAINTENANCE = 'MAINTENANCE',
  RESERVED = 'RESERVED',
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

  @IsUUID('4', { message: '楼栋ID格式错误' })
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
