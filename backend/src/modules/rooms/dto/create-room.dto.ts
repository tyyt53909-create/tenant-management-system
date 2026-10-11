import { IsString, IsNotEmpty, IsUUID, IsInt, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';

enum RoomType {
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

  @IsUUID('4', { message: '楼栋ID格式错误' })
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
  facilities?: any; // JSON 格式的设施信息

  @IsString()
  @IsOptional()
  description?: string;
}
