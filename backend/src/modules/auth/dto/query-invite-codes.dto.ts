import { IsInt, IsOptional, IsString, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { InviteCodeStatus } from '@prisma/client';

export class QueryInviteCodesDto {
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

  @IsEnum(InviteCodeStatus)
  @IsOptional()
  status?: InviteCodeStatus;

  @IsString()
  @IsOptional()
  search?: string;
}
