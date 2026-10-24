import { IsDateString, IsInt, Min } from 'class-validator';

/** 调价（FIN-08 / T274）：单价以分为单位，生效日按业务日（UTC 零点）落库。 */
export class SetMeterPriceDto {
  @IsInt()
  @Min(0)
  unitPrice: number;

  @IsDateString()
  effectiveDate: string;
}
