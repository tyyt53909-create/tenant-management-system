import { IsOptional, IsInt, IsBoolean, IsString, MaxLength, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryTenantsDto {
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

  /** 姓名模糊查询（前端查询表单一直有该输入框，此前后端未声明导致 400） */
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  /** 手机号模糊查询（支持只输入后几位） */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  /**
   * 是否启用。
   * 注意不能用 @Type(() => Boolean)：查询串中的 "false" 是非空字符串，
   * Boolean("false") === true，会把 false 误判为 true（同类问题见 T156 unreadOnly）。
   */
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  isActive?: boolean;

  /** 标签筛选（T215）：传标签 ID，返回带该标签的租客 */
  @IsString()
  @IsOptional()
  @MaxLength(40)
  tagId?: string;
}
