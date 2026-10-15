import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CleanStatus, RoomStatus } from './update-room.dto.js';

/**
 * 房态流转（docs/04-状态机.md §1）
 * - version 必填：乐观锁并发控制，冲突返回 409「房间状态已被其他用户修改」
 * - status / cleanStatus 至少提供一个；流转合法性由服务层校验
 */
export class UpdateRoomStatusDto {
  @IsEnum(RoomStatus, { message: '房态必须为 VACANT, RESERVED, OCCUPIED 或 MAINTENANCE' })
  @IsOptional()
  status?: RoomStatus;

  @IsEnum(CleanStatus, { message: '清洁状态必须为 CLEAN, PENDING_CLEAN 或 CLEANING' })
  @IsOptional()
  cleanStatus?: CleanStatus;

  @IsInt({ message: '版本号必须为整数（乐观锁）' })
  @Min(0)
  version: number;
}
