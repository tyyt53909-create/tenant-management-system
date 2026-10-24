import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/** 每间房源最多照片数；与数据模型 §2.23 及详情查询上限一致。 */
export const MAX_ROOM_PHOTOS = 20;

/**
 * 房源照片只接受文件上传接口返回的站内地址，避免把任意外链写进公开看房页。
 * 私有上传结果为 `/api/files/<key>`；公开上传（T261）为 `/api/public/files/<key>`。
 */
export const ROOM_PHOTO_URL_PATTERN = /^\/api\/(?:public\/)?files\/[A-Za-z0-9._-]+$/;

export class RoomPhotoDto {
  @IsString()
  @IsNotEmpty({ message: '照片地址不能为空' })
  @MaxLength(500, { message: '照片地址过长' })
  @Matches(ROOM_PHOTO_URL_PATTERN, { message: '照片地址必须来自文件上传接口' })
  fileUrl: string;

  /** 缩略图地址；上传接口未生成缩略图时可为空。 */
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '缩略图地址过长' })
  @Matches(ROOM_PHOTO_URL_PATTERN, { message: '缩略图地址必须来自文件上传接口' })
  thumbnail?: string | null;

  /** 文件大小（字节），仅用于展示；取不到时按 0 记录。 */
  @IsOptional()
  @IsInt({ message: '文件大小必须为整数' })
  @Min(0, { message: '文件大小不能为负数' })
  fileSize?: number;
}
