import { ApiProperty } from '@nestjs/swagger';

export class RentDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['PAYMENT', 'REFUND', 'CORRECTION'] }) type!: 'PAYMENT' | 'REFUND' | 'CORRECTION';
  @ApiProperty({ type: String, nullable: true }) businessDate!: string | null;
  @ApiProperty() billId!: string;
  @ApiProperty({ type: String, nullable: true }) paymentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) refundId!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: '租金本金，分；退款和更正为负数，未知为 null' }) amount!: number | null;
  @ApiProperty({ description: '原交易总额（分，可能包含滞纳金）' }) grossAmount!: number;
  @ApiProperty() verified!: boolean;
  @ApiProperty({ type: String, nullable: true }) unknownReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) paymentMethod!: string | null;
}
export class RentReportResponseDto {
  @ApiProperty() month!: string;
  @ApiProperty() buildingId!: string;
  @ApiProperty({ type: [RentDetailDto] }) details!: RentDetailDto[];
  @ApiProperty({ type: [RentDetailDto] }) undatedDetails!: RentDetailDto[];
  @ApiProperty({ type: Number, nullable: true }) rentIncome!: number | null;
  @ApiProperty() verifiedAllocationRentSubtotal!: number;
  @ApiProperty() verifiedRefundSubtotal!: number;
  @ApiProperty() verifiedCorrectionSubtotal!: number;
  @ApiProperty() unknownAllocationCount!: number;
  @ApiProperty() unknownAdjustmentCount!: number;
  @ApiProperty() paidExpenses!: number;
  @ApiProperty() currentPrepayBalance!: number;
  @ApiProperty({ enum: ['complete', 'incomplete'] }) status!: 'complete' | 'incomplete';
  @ApiProperty({ type: Number, nullable: true }) netOperatingIncome!: number | null;
  @ApiProperty() basis!: string;
  @ApiProperty({ type: [String] }) limitations!: string[];
  @ApiProperty() hasRentAdjustments!: boolean;
}
