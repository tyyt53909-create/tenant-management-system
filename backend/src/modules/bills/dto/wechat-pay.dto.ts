import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class WechatJsapiPayDto {
  /** 支付金额（单位：分，可选；不传则默认为该账单当前待缴金额） */
  @IsOptional()
  @IsInt({ message: '支付金额必须为整数（单位：分）' })
  @Min(1, { message: '支付金额必须大于 0' })
  amount?: number;
}

export class WechatPayQueryDto {
  /** 商户订单号 (out_trade_no) */
  @IsString({ message: '商户订单号不能为空' })
  outTradeNo: string;
}
