import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAnnouncementsDto {
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

  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  @IsOptional()
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @IsString()
  @IsOptional()
  @MaxLength(100)
  q?: string;
}
