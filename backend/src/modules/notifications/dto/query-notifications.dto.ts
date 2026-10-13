import { IsOptional, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryNotificationsDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  /**
   * 只看未读。
   *
   * 注意：不能用 @Type(() => Boolean) —— 查询串里的 "false" 是非空字符串，
   * Boolean("false") === true，会导致 unreadOnly=false 被当成 true
   * （T156 实测：false 与 true 返回相同结果，仅省略参数才是全部）。
   * 这里显式只接受 true / "true"。
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  unreadOnly?: boolean;
}
