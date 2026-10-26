import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsDateString,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { CheckoutReasonType } from '@prisma/client';

export class CreateCheckoutRequestDto {
  @IsString({ message: '合同ID必须为字符串' })
  @IsNotEmpty({ message: '关联合同ID不能为空' })
  contractId: string;

  @IsDateString({}, { message: '期望退租日期格式必须为合法日期 (YYYY-MM-DD)' })
  expectedCheckoutDate: string;

  @IsEnum(CheckoutReasonType, { message: '退租原因类型无效' })
  @IsOptional()
  reasonType?: CheckoutReasonType = CheckoutReasonType.NORMAL_EXPIRE;

  @IsString({ message: '退租原因详细描述必须为字符串' })
  @IsOptional()
  @MaxLength(500, { message: '详细描述最多500字符' })
  reasonDetail?: string;

  @IsOptional()
  refundAccount?: {
    type?: 'BANK' | 'WECHAT' | 'ALIPAY';
    bankName?: string;
    accountNo?: string;
    accountName?: string;
    [key: string]: any;
  };
}
