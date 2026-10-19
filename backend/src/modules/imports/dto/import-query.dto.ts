import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportPreviewQueryDto {
  /** 楼栋 ID；不传时用 DEFAULT_BUILDING_ID */
  @IsString()
  @IsOptional()
  @MaxLength(40)
  buildingId?: string;
}

export class ImportCommitQueryDto extends ImportPreviewQueryDto {
  /**
   * true = 只预检不写入（默认）；false = 真正写入。
   * 用显式开关而不是「预检接口 + 写入接口」两个上传来避免文件被上传两次。
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  dryRun?: boolean;
}
