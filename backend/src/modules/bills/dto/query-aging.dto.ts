import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BillType } from './query-bills.dto.js';
export class QueryAgingDto {
  @ApiPropertyOptional({ enum: BillType }) @IsOptional() @IsEnum(BillType) billType?: BillType;
  @ApiPropertyOptional() @IsOptional() @IsString() buildingId?: string;
}
