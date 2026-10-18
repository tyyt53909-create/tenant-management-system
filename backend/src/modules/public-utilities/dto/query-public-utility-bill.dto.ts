import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class QueryPublicUtilityBillDto {
  @IsString()
  @IsOptional()
  @MaxLength(40)
  buildingId?: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period 需为 YYYY-MM' })
  @IsOptional()
  period?: string;
}
