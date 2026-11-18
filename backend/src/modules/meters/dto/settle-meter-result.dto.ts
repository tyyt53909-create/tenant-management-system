import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SETTLEMENT_REASON_CODES = [
  'SETTLED', 'ALREADY_SETTLED', 'ZERO_USAGE', 'ZERO_CHARGE', 'PUBLIC_AREA',
  'NO_ACTIVE_CONTRACT', 'MISSING_PREPAY_ACCOUNT', 'NO_READINGS', 'METER_NOT_FOUND',
  'PREVIEW_STALE', 'SETTLEMENT_FAILED',
] as const;

export class MeterSettlementPreviewDto {
  meterId!: string;
  /** 服务端预览使用的截止时间。确认与重试应原样传回。 */
  @ApiProperty({ type: String, format: 'date-time' })
  settleUntil!: string;
  /** 截止时间内的最新读数，在结算事务中核对。 */
  targetReadingId?: string;
  meterNumber?: string;
  meterType?: string;
  unitPrice?: number;
  roomNumber?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  tenantName?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  prepayBalance?: number | null;
  lastSettledReading!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSettledTime!: Date | null;
  currentReading!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readingTime!: Date | null;
  unsettledUsage!: number;
  estimatedAmount!: number;
  hasReadings!: boolean;
}

export class MeterSettlementResultDto {
  @ApiProperty()
  meterId!: string;

  @ApiProperty({ enum: ['SETTLED', 'NO_CHANGE', 'BLOCKED', 'FAILED'] })
  status!: 'SETTLED' | 'NO_CHANGE' | 'BLOCKED' | 'FAILED';

  @ApiProperty({ enum: SETTLEMENT_REASON_CODES })
  reasonCode!: (typeof SETTLEMENT_REASON_CODES)[number];

  @ApiProperty({ description: '兼容旧调用方，零用量也可能写入结算标记。计费结果请读取 status。' })
  settled!: boolean;

  @ApiProperty()
  usage!: number;

  @ApiProperty({ description: '整数分。未处理的读数可能返回预计应收金额，实际入账以 status 和凭证为准。' })
  amount!: number;

  @ApiPropertyOptional()
  unitPrice?: number;

  @ApiPropertyOptional()
  baselineReading?: number;

  @ApiPropertyOptional()
  currentReading?: number;

  @ApiPropertyOptional()
  reason?: string;

  @ApiPropertyOptional()
  retryCondition?: string;

  @ApiPropertyOptional()
  billId?: string;

  @ApiPropertyOptional()
  prepayTransactionId?: string;
}

export class MeterBatchSettlementItemDto extends MeterSettlementResultDto {
  @ApiProperty({ description: '仅 SETTLED 为 true。' })
  success!: boolean;

  @ApiPropertyOptional()
  error?: string;
}

export class MeterBatchSettlementResultDto {
  @ApiProperty({ description: '本批使用的结算截止时间，可用于按原范围重试。' })
  settleUntil!: string;
  @ApiProperty()
  total!: number;

  @ApiProperty()
  settledCount!: number;

  @ApiProperty()
  noChangeCount!: number;

  @ApiProperty()
  blockedCount!: number;

  @ApiProperty()
  failedCount!: number;

  @ApiProperty({ description: '兼容字段，等于 settledCount。' })
  successCount!: number;

  @ApiProperty({ description: '兼容字段，等于 blockedCount + failedCount。' })
  failureCount!: number;

  @ApiProperty({ type: [MeterBatchSettlementItemDto] })
  results!: MeterBatchSettlementItemDto[];
}
