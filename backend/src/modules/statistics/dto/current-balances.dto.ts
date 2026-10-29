import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
export class CurrentBalancesQueryDto { @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() buildingId?: string; }
export class BalanceMovementDto {
  @ApiProperty() id!: string; @ApiProperty() type!: string; @ApiProperty() amount!: number;
  @ApiProperty() balanceAfter!: number; @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: String, nullable: true }) relatedId!: string | null;
  @ApiProperty({ type: String, nullable: true }) relatedType!: string | null;
}
export class BalanceItemDto {
  @ApiProperty() id!: string; @ApiProperty({ type: String, nullable: true }) contractId!: string | null;
  @ApiProperty() roomId!: string; @ApiProperty({ type: Number, nullable: true }) balance!: number | null;
  @ApiProperty({ enum: ['consistent', 'inconsistent', 'unknown'] }) arithmetic!: 'consistent' | 'inconsistent' | 'unknown'; @ApiProperty() inScope!: boolean; @ApiProperty({ type: [String] }) reasons!: string[];
  @ApiProperty({ type: [BalanceMovementDto] }) movements!: BalanceMovementDto[];
}
export class BalanceCategoryDto {
  @ApiProperty({ type: [BalanceItemDto] }) items!: BalanceItemDto[];
  @ApiProperty() bookSubtotal!: number; @ApiProperty() unknownCount!: number;
  @ApiProperty({ type: Number, nullable: true }) verifiedTotal!: number | null;
}
export class CurrentBalancesResponseDto {
  @ApiProperty({ type: String, nullable: true }) buildingId!: string | null; @ApiProperty() unassignedPrepayCount!: number; @ApiProperty() unassignedDepositCount!: number; @ApiProperty() capturedAt!: Date;
  @ApiProperty({ type: BalanceCategoryDto }) deposit!: BalanceCategoryDto;
  @ApiProperty({ type: BalanceCategoryDto }) prepay!: BalanceCategoryDto;
  @ApiProperty({ type: [String] }) limitations!: string[];
}
