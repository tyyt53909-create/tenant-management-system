import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RoomType, LeadSource } from '@prisma/client';

export class CreatePublicLeadDto {
  @IsString({ message: '姓名必须为字符串' })
  @IsNotEmpty({ message: '姓名不能为空' })
  @MaxLength(50, { message: '姓名最多50字符' })
  name: string;

  @IsString({ message: '手机号必须为字符串' })
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @IsEnum(RoomType, { message: '意向房型无效' })
  @IsOptional()
  roomType?: RoomType;

  @IsInt({ message: '最低预算必须为整数（单位：分）' })
  @Min(0, { message: '预算不能为负数' })
  @IsOptional()
  @Type(() => Number)
  budgetMin?: number;

  @IsInt({ message: '最高预算必须为整数（单位：分）' })
  @Min(0, { message: '预算不能为负数' })
  @IsOptional()
  @Type(() => Number)
  budgetMax?: number;

  @IsString({ message: '期望入住日期格式错误' })
  @IsOptional()
  expectedMoveIn?: string;

  @IsEnum(LeadSource, { message: '渠道来源无效' })
  @IsOptional()
  source?: LeadSource;

  @IsString({ message: '意向房源 ID 格式错误' })
  @IsOptional()
  roomId?: string;

  @IsString({ message: '备注必须为字符串' })
  @MaxLength(500, { message: '备注最多500字符' })
  @IsOptional()
  notes?: string;
}
