import { IsInt, IsOptional, IsString, IsEnum, Min, Max } from 'class-validator';
import { UserRole } from '@prisma/client';

export class GenerateInviteCodeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650) // 最多10年
  expiryDays?: number = 365;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  count?: number = 1;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /** 租客邀请必须指定预建档案。职员邀请不要填。 */
  @IsOptional()
  @IsString()
  tenantId?: string;
}
