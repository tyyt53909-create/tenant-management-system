import {
  IsInt,
  Min,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RenewalOfferStatus } from '@prisma/client';

export class CreateRenewalOfferDto {
  @IsInt({ message: '报价月租金必须为整数（分）' })
  @Min(0, { message: '报价月租金不能为负' })
  offeredRent: number;

  @IsInt({ message: '报价押金必须为整数（分）' })
  @Min(0, { message: '报价押金不能为负' })
  offeredDeposit: number;

  @IsDateString({}, { message: '续约起始日期格式不正确' })
  startDate: string;

  @IsDateString({}, { message: '续约到期日期格式不正确' })
  endDate: string;

  @IsString({ message: '特惠折扣说明必须为字符串' })
  @IsOptional()
  @MaxLength(500, { message: '折扣说明最多500字符' })
  discountNotes?: string;

  @IsDateString({}, { message: '报价有效期格式不正确' })
  @IsOptional()
  validUntil?: string;
}

export class RespondRenewalOfferDto {
  @IsBoolean({ message: '是否接受报价必须为布尔值' })
  agree: boolean; // true 为接受, false 为拒绝

  @IsString({ message: '拒绝原因必须为字符串' })
  @IsOptional()
  @MaxLength(500, { message: '拒绝原因最多500字符' })
  rejectReason?: string;
}

export class QueryRenewalOffersDto {
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
  @IsEnum(RenewalOfferStatus)
  status?: RenewalOfferStatus;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;
}
