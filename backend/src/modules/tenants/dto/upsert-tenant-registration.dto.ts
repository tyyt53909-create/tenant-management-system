import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IdType, RegistrationStatus } from '@prisma/client';

/** 写入/更新居住登记（SEC-08 / T271）。不传 idNumber 表示只改状态或备注。 */
export class UpsertTenantRegistrationDto {
  @IsEnum(IdType)
  idType: IdType;

  @IsString()
  @MinLength(4, { message: '证件号至少 4 位' })
  @MaxLength(64, { message: '证件号过长' })
  @IsOptional()
  idNumber?: string;

  @IsEnum(RegistrationStatus)
  @IsOptional()
  status?: RegistrationStatus;

  @IsString()
  @MaxLength(500, { message: '备注不能超过 500 字' })
  @IsOptional()
  notes?: string;
}
