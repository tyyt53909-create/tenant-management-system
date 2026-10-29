import { ApiProperty } from '@nestjs/swagger';

export class RentReportResponseDto {
  @ApiProperty() month!: string;
  @ApiProperty() buildingId!: string;
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
