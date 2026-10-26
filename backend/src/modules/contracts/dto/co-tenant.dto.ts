import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  Matches,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { IdType } from '@prisma/client';

export class CreateCoTenantDto {
  @IsString({ message: '姓名必须为字符串' })
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(50, { message: '姓名最多50字符' })
  name: string;

  @IsString({ message: '手机号必须为字符串' })
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsEnum(IdType, { message: '证件类型无效' })
  @IsOptional()
  idType?: IdType = IdType.ID_CARD;

  @IsString({ message: '证件号必须为字符串' })
  @IsOptional()
  idNumber?: string;

  @IsString({ message: '与主承租人关系必须为字符串' })
  @IsOptional()
  @MaxLength(50, { message: '关系描述最多50字符' })
  relationship?: string;

  @IsBoolean({ message: '是否签约人必须为布尔值' })
  @IsOptional()
  isSigner?: boolean = false;
}

export class AddCoTenantDto extends CreateCoTenantDto {}
