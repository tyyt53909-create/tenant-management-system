import { IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** 清洁照片（上传后回传 URL，docs/09-待确认清单.md #11 规格） */
export class CleanPhotoDto {
  @IsString()
  @IsNotEmpty({ message: '照片地址不能为空' })
  fileUrl: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  /** 文件大小（字节），缺省 0 */
  @IsInt()
  @Min(0)
  @IsOptional()
  fileSize?: number;
}

/**
 * 标记已清洁（docs/05-接口规范.md §8.2：PATCH /rooms/:id/clean）
 * VACANT+CLEANING → VACANT+CLEAN（需先接单）
 */
export class MarkCleanDto {
  /** 乐观锁版本（可选，提供则冲突 409） */
  @IsInt()
  @Min(0)
  @IsOptional()
  version?: number;

  /** 可选清洁照片 */
  @IsOptional()
  @ValidateNested()
  @Type(() => CleanPhotoDto)
  photo?: CleanPhotoDto;
}
