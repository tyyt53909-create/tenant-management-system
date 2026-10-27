import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class WechatReconciliationQueryDto {
  @IsNotEmpty({ message: '对账日期不能为空' })
  @IsString({ message: '对账日期必须是字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '对账日期格式必须为 YYYY-MM-DD' })
  billDate: string;

  @IsOptional()
  @IsBoolean({ message: 'autoSyncMissing 必须是布尔值' })
  autoSyncMissing?: boolean;
}

export interface WechatReconciliationDiscrepancy {
  type: 'REMOTE_ONLY' | 'LOCAL_ONLY' | 'AMOUNT_MISMATCH';
  outTradeNo: string;
  transactionId?: string;
  wechatAmount?: number;
  localAmount?: number;
  synced?: boolean;
  reason?: string;
}

export class WechatReconciliationResponseDto {
  billDate: string;
  totalWechatCount: number;
  totalWechatAmount: number;
  totalLocalCount: number;
  totalLocalAmount: number;
  matchedCount: number;
  matchedAmount: number;
  remoteOnlyCount: number;
  localOnlyCount: number;
  amountMismatchCount: number;
  discrepancies: WechatReconciliationDiscrepancy[];
}
