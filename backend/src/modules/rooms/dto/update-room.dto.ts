import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateRoomDto } from './create-room.dto.js';
import { MAX_ROOM_PHOTOS, RoomPhotoDto } from './room-photo.dto.js';

export enum RoomStatus {
  VACANT = 'VACANT',
  RESERVED = 'RESERVED',
  OCCUPIED = 'OCCUPIED',
  MAINTENANCE = 'MAINTENANCE',
}

export enum CleanStatus {
  CLEAN = 'CLEAN',
  PENDING_CLEAN = 'PENDING_CLEAN',
  CLEANING = 'CLEANING',
}

export class UpdateRoomDto extends PartialType(CreateRoomDto) {
  @IsEnum(RoomStatus, { message: '房态必须为 VACANT, RESERVED, OCCUPIED 或 MAINTENANCE' })
  @IsOptional()
  status?: RoomStatus;

  @IsEnum(CleanStatus, { message: '清洁状态必须为 CLEAN, PENDING_CLEAN 或 CLEANING' })
  @IsOptional()
  cleanStatus?: CleanStatus;

  /** 乐观锁版本号（来自查询结果；提供时执行并发冲突检查，冲突返回 409） */
  @IsInt({ message: '版本号必须为整数' })
  @Min(0)
  @IsOptional()
  version?: number;

  /**
   * 房源照片全量替换（省略则不修改照片）。
   * 数组顺序即展示顺序，第一张作为封面；最多 20 张。
   */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RoomPhotoDto)
  @ArrayMaxSize(MAX_ROOM_PHOTOS, { message: `房源照片最多 ${MAX_ROOM_PHOTOS} 张` })
  photos?: RoomPhotoDto[];
}
