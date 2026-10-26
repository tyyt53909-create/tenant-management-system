import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class PrepayRechargeJsapiDto {
  /** 充值金额（单位：分，最低 100 分即 1 元，最高 5,000,000 分即 5 万元） */
  @IsInt({ message: '充值金额必须为整数（单位：分）' })
  @Min(100, { message: '充值金额最低为 100 分（1元）' })
  @Max(5000000, { message: '充值金额单笔最高为 5,000,000 分（5万元）' })
  amount: number;
}

export class PrepayRechargeQueryDto {
  /** 微信支付商户订单号 (outTradeNo) */
  @IsString({ message: '商户订单号必须为字符串' })
  @IsNotEmpty({ message: '商户订单号不能为空' })
  outTradeNo: string;
}
