import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeterResponsibilityType, UtilityCollectionMode } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class ReviewUtilityRuleDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100)
  meterId!: string;

  @ApiProperty({ enum: MeterResponsibilityType }) @IsEnum(MeterResponsibilityType)
  responsibility!: MeterResponsibilityType;

  @ApiPropertyOptional() @ValidateIf((dto: ReviewUtilityRuleDto) => dto.responsibility === 'TENANT' || dto.contractId !== undefined)
  @IsString() @IsNotEmpty() @MaxLength(100)
  contractId?: string;

  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100)
  openingReadingId!: string;

  @ApiPropertyOptional({ description: '留空登记开放责任段；结束时以真实终读数封口' }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  closingReadingId?: string;

  @ApiPropertyOptional({ description: '封口已有开放责任段的编号' }) @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  responsibilityIntervalId?: string;

  @ApiPropertyOptional({ enum: UtilityCollectionMode })
  @ValidateIf((dto: ReviewUtilityRuleDto) => dto.responsibility === 'TENANT' || dto.collectionMode !== undefined) @IsEnum(UtilityCollectionMode)
  collectionMode?: UtilityCollectionMode;

  @ApiPropertyOptional({ description: '每单位费率，以分为单位，最多六位小数', example: '61.7' })
  @ValidateIf((dto: ReviewUtilityRuleDto) => dto.responsibility === 'TENANT' || dto.rateCents !== undefined) @IsString()
  @Matches(/^(0|[1-9]\d{0,9})(\.\d{1,6})?$/)
  rateCents?: string;

  @ApiProperty({ description: '已核对的规则及交接证据说明' })
  @IsString() @Matches(/\S/) @MaxLength(1000)
  evidence!: string;
}

export class ConfirmUtilityRuleDto extends ReviewUtilityRuleDto {
  @ApiProperty() @IsUUID('4') requestId!: string;
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
}

export class UtilityInventoryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  buildingId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100)
  afterId?: string;
}
