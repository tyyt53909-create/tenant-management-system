import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export enum ShapeKindDto {
  RECT = 'RECT',
  POLYGON = 'POLYGON',
}

export class RoomShapeDto {
  @IsOptional() @IsString() roomId?: string | null;
  @IsEnum(ShapeKindDto) kind!: ShapeKindDto;
  @Type(() => Number) @IsNumber() x!: number;
  @Type(() => Number) @IsNumber() y!: number;
  @Type(() => Number) @IsNumber() @Min(0) width!: number;
  @Type(() => Number) @IsNumber() @Min(0) depth!: number;
  @IsOptional() polygon?: unknown;
  @IsOptional() @Type(() => Number) @IsNumber() rotation?: number;
}

export class SaveFloorPlanDto {
  @Type(() => Number) @IsNumber() @Min(0) width!: number;
  @Type(() => Number) @IsNumber() @Min(0) depth!: number;
  @Type(() => Number) @IsInt() @Min(0) version!: number;
  @IsOptional() @IsString() backgroundUrl?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RoomShapeDto) shapes!: RoomShapeDto[];
}
