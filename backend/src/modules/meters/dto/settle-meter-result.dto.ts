import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SETTLEMENT_REASON_CODES = [
  'SETTLED', 'ALREADY_SETTLED', 'ZERO_USAGE', 'ZERO_CHARGE', 'PUBLIC_AREA',
  'NO_ACTIVE_CONTRACT', 'MISSING_PREPAY_ACCOUNT', 'NO_READINGS', 'METER_NOT_FOUND',
  'SETTLEMENT_FAILED', 'OCCUPANCY_UNCERTAIN', 'VACANT_INTERVAL', 'UNCONFIRMED_HANDOFF', 'MISSING_RATE_BOUNDARY',
] as const;

export class MeterChargeSegmentDto {
  @ApiProperty() startReadingId!: string;
  @ApiProperty() endReadingId!: string;
  @ApiProperty() startAt!: string;
  @ApiProperty() endAt!: string;
  @ApiProperty() startReading!: number;
  @ApiProperty() endReading!: number;
  @ApiProperty() usage!: number;
  @ApiProperty() unitPrice!: number;
  @ApiPropertyOptional() nextOpeningReading?: number;
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

  @ApiPropertyOptional({ type: [MeterChargeSegmentDto] })
  segments?: MeterChargeSegmentDto[];

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
  contractId?: string;

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
