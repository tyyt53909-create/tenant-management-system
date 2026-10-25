import { IsOptional, IsInt, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

enum RoomType {
  SINGLE = 'SINGLE',
  ONE_BED = 'ONE_BED',
  TWO_BED = 'TWO_BED',
  THREE_BED = 'THREE_BED',
  STUDIO = 'STUDIO',
}

export class QueryPublicRoomsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  buildingId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  floor?: number;

  @IsOptional()
  @IsEnum(RoomType)
  roomType?: RoomType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;
}
