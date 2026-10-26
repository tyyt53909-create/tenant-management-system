import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { ContractTemplateStatus } from '@prisma/client';

export class CreateContractTemplateDto {
  @IsString({ message: '模板名称必须为字符串' })
  @IsNotEmpty({ message: '模板名称不能为空' })
  @MaxLength(100, { message: '模板名称最多100字符' })
  name: string;

  @IsString({ message: '模板编码必须为字符串' })
  @IsNotEmpty({ message: '模板编码不能为空' })
  @MaxLength(50, { message: '模板编码最多50字符' })
  code: string;

  @IsString({ message: '模板说明必须为字符串' })
  @IsOptional()
  @MaxLength(500, { message: '说明最多500字符' })
  description?: string;

  @IsString({ message: '条款正文必须为字符串' })
  @IsNotEmpty({ message: '条款正文不能为空' })
  content: string;

  @IsOptional()
  terms?: Record<string, unknown> | unknown[];

  @IsBoolean({ message: '默认标记必须为布尔值' })
  @IsOptional()
  isDefault?: boolean = false;

  @IsEnum(ContractTemplateStatus, { message: '模板状态无效' })
  @IsOptional()
  status?: ContractTemplateStatus = ContractTemplateStatus.ACTIVE;
}

export class UpdateContractTemplateDto extends PartialType(CreateContractTemplateDto) {}

export class QueryContractTemplatesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(ContractTemplateStatus)
  status?: ContractTemplateStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}
