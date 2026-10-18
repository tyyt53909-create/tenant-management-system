import { IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class QueryBuildingsDto {
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

  @IsBoolean()
  @IsOptional()
  // 不能用 @Type(() => Boolean)：class-transformer 会把字符串 "false" 转成 true（?isActive=false 反被当成筛选启用）
  @Transform(({ value }) => value === true || value === 'true')
  isActive?: boolean;
}
