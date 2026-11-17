import { Type } from 'class-transformer';
import {
  IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { CreateContractDto } from './create-contract.dto.js';

export class MoveInLeaseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contractId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateContractDto)
  contract?: CreateContractDto;
}

export class MoveInReadingDto {
  @IsString()
  @IsNotEmpty()
  meterId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  currentReading!: number;
}

export class ConfirmMoveInDto extends MoveInLeaseDto {
  @IsUUID('4')
  requestId!: string;

  @Matches(/^[0-9a-f]{64}$/)
  reviewToken!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoveInReadingDto)
  readings!: MoveInReadingDto[];
}

class MoveInMeterDto {
  id!: string;
  meterNumber!: string;
  meterType!: string;
}

class MoveInBillDto {
  billType!: 'RENT' | 'DEPOSIT';
  period!: string;
  amount!: number;
  dueDate!: Date;
}

export class MoveInPreviewDto {
  reviewToken!: string;
  tenantName!: string;
  meters!: MoveInMeterDto[];
  bills!: MoveInBillDto[];
}

class MoveInBaselineDto {
  meterId!: string;
  readingId!: string;
  currentReading!: number;
}

class OccupiedRoomDto {
  id!: string;
  status!: string;
  version!: number;
}

export class MoveInResultDto {
  requestId!: string;
  contractId!: string;
  occupiedAt!: string;
  billIds!: string[];
  prepayAccountId!: string;
  baselines!: MoveInBaselineDto[];
  room!: OccupiedRoomDto;
}
