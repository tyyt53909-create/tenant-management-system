import {
  ArrayMaxSize,
  IsString,
  IsNotEmpty,
  IsInt,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_ROOM_PHOTOS, RoomPhotoDto } from './room-photo.dto.js';

export enum RoomType {
  SINGLE = 'SINGLE',
  ONE_BED = 'ONE_BED',
  TWO_BED = 'TWO_BED',
  THREE_BED = 'THREE_BED',
  STUDIO = 'STUDIO',
}

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty({ message: '房号不能为空' })
  roomNumber: string;

  @IsString({ message: '楼栋ID格式错误' })
  @IsNotEmpty({ message: '楼栋ID不能为空' })
  buildingId: string;

  @IsInt({ message: '楼层必须为整数' })
  @Min(0, { message: '楼层不能为负数' })
  floor: number;

  @IsEnum(RoomType, { message: '房型必须为 SINGLE, ONE_BED, TWO_BED, THREE_BED 或 STUDIO' })
  roomType: RoomType;

  @IsNumber({}, { message: '面积必须为数字' })
  @Min(0.01, { message: '面积必须大于0' })
  @IsOptional()
  area?: number;

  @IsOptional()
  facilities?: Record<string, unknown> | unknown[]; // JSON 格式的设施信息

  @IsString()
  @IsOptional()
  description?: string;

  /**
   * 房源照片（先 POST /api/files/upload 取得 url 再提交）。
   * 数组顺序即展示顺序，第一张作为封面；最多 20 张。
   */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RoomPhotoDto)
  @ArrayMaxSize(MAX_ROOM_PHOTOS, { message: `房源照片最多 ${MAX_ROOM_PHOTOS} 张` })
  photos?: RoomPhotoDto[];
}
