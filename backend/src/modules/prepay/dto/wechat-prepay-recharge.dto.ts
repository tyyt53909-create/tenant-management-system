import { IsInt, Min, Max, IsString, IsNotEmpty } from 'class-validator';

export class PrepayJsapiRechargeDto {
  @IsInt({ message: '充值金额必须为整数（单位：分）' })
  @Min(1, { message: '充值金额必须大于 0' })
  @Max(10000000, { message: '单笔充值金额不能超过 10 万元' })
  amount: number;
}

export class PrepayQueryRechargeDto {
  @IsString({ message: '商户单号必须为字符串' })
  @IsNotEmpty({ message: '商户单号不能为空' })
  outTradeNo: string;
}
