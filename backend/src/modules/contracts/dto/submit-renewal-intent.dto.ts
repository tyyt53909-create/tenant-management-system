import { IsEnum, IsOptional, IsInt, Min, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { RenewalIntentType } from '@prisma/client';

export class SubmitRenewalIntentDto {
  @IsEnum(RenewalIntentType, { message: '意向类型必须为 RENEW, NOT_RENEW 或 CONSIDERING' })
  intent: RenewalIntentType;

  @IsInt({ message: '期望租期必须为整数月' })
  @Min(1, { message: '期望租期至少1个月' })
  @IsOptional()
  expectedMonths?: number;

  @IsInt({ message: '期望月租必须为整数（分）' })
  @Min(0, { message: '期望月租不能为负数' })
  @IsOptional()
  expectedRent?: number;

  @IsString({ message: '备注留言必须为字符串' })
  @IsOptional()
  @MaxLength(500, { message: '备注留言最多500字符' })
  notes?: string;
}

export class QueryRenewalIntentsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(RenewalIntentType)
  intent?: RenewalIntentType;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}
