import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateRoomDto } from './create-room.dto.js';

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
}
