import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IdType } from '@prisma/client';

/**
 * 租客自助提交实名登记 DTO（LSE-05 / T297）
 */
export class SubmitTenantRegistrationDto {
  @IsEnum(IdType, { message: '证件类型必须为有效枚举（ID_CARD / PASSPORT / OTHER）' })
  idType: IdType;

  @IsString({ message: '证件号必须为字符串' })
  @MinLength(4, { message: '证件号至少 4 位' })
  @MaxLength(64, { message: '证件号过长' })
  idNumber: string;

  @IsString({ message: '真实姓名必须为字符串' })
  @MaxLength(50, { message: '真实姓名不能超过 50 字' })
  @IsOptional()
  realName?: string;

  @IsString({ message: '紧急联系人必须为字符串' })
  @MaxLength(50, { message: '紧急联系人不能超过 50 字' })
  @IsOptional()
  emergencyContact?: string;

  @IsString({ message: '紧急联系电话必须为字符串' })
  @MaxLength(20, { message: '紧急联系电话不能超过 20 字' })
  @IsOptional()
  emergencyPhone?: string;
}
