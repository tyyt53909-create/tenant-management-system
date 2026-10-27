import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateWechatRefundDto {
  @IsInt({ message: '退款金额必须为整数（分）' })
  @Min(1, { message: '退款金额必须大于 0' })
  amount: number;

  @IsOptional()
  @IsString({ message: '退款原因必须是字符串' })
  reason?: string;

  @IsOptional()
  @IsString({ message: '商户退款单号必须是字符串' })
  outRefundNo?: string;
}

export class WechatRefundResponseDto {
  billId: string;
  paymentId: string;
  outRefundNo: string;
  refundId: string;
  refundAmount: number;
  status: string;
  reversalPaymentId: string;
  remainingPaidAmount: number;
}
