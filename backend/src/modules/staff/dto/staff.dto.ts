import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const STAFF_ROLES = [
  'ADMIN',
  'PROPERTY_MANAGER',
  'FINANCIAL',
  'MAINTAINER',
  'CLEANER',
  'OWNER',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export class QueryStaffDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @IsOptional()
  @IsEnum(STAFF_ROLES)
  role?: StaffRole;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  buildingId?: string;
}

export class CreateStaffDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString({ message: '密码必须为字符串' })
  @MinLength(8, { message: '密码长度至少8位' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsEnum(STAFF_ROLES, {
    message: '角色必须为合法员工角色（ADMIN, PROPERTY_MANAGER, FINANCIAL, MAINTAINER, CLEANER, OWNER）',
  })
  role: StaffRole;

  @IsOptional()
  @IsArray({ message: '负责楼栋ID列表必须为数组' })
  @IsString({ each: true, message: '每个楼栋ID必须为字符串' })
  buildingIds?: string[];
}

export class UpdateStaffDto {
  @IsOptional()
  @IsEnum(STAFF_ROLES, { message: '角色必须为合法员工角色' })
  role?: StaffRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @IsArray({ message: '负责楼栋ID列表必须为数组' })
  @IsString({ each: true, message: '每个楼栋ID必须为字符串' })
  buildingIds?: string[];
}

export class ResetStaffPasswordDto {
  @IsString({ message: '新密码必须为字符串' })
  @MinLength(8, { message: '新密码长度至少8位' })
  newPassword: string;
}

export class AssignStaffBuildingsDto {
  @IsArray({ message: '负责楼栋ID列表必须为数组' })
  @IsString({ each: true, message: '每个楼栋ID必须为字符串' })
  buildingIds: string[];
}
