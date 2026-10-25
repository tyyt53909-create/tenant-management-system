import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const ANNOUNCEMENT_PRIORITIES = ['NORMAL', 'URGENT'] as const;
export const ANNOUNCEMENT_AUDIENCES = ['ALL_TENANTS', 'BUILDING', 'TAGS', 'TENANTS'] as const;

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty({ message: '标题不能为空' })
  @MaxLength(200, { message: '标题最多200字符' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: '正文不能为空' })
  @MaxLength(5000, { message: '正文最多5000字符' })
  body: string;

  @IsEnum(ANNOUNCEMENT_PRIORITIES)
  @IsOptional()
  priority?: (typeof ANNOUNCEMENT_PRIORITIES)[number];

  @IsIn(ANNOUNCEMENT_AUDIENCES)
  @IsOptional()
  audience?: (typeof ANNOUNCEMENT_AUDIENCES)[number];

  /** 目标 ID：BUILDING=楼栋，TAGS=标签，TENANTS=租客；ALL_TENANTS 忽略 */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsOptional()
  targetIds?: string[];

  /** 立即发布到站内通知；为 false/省略时只存草稿 */
  @IsOptional()
  publish?: boolean;

  @IsISO8601()
  @IsOptional()
  expiredAt?: string;
}

export class UpdateAnnouncementDto extends CreateAnnouncementDto {}
