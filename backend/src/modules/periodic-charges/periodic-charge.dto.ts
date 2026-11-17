import { IsDateString, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class PreviewPeriodicChargeDto {
  @IsString()
  @IsNotEmpty()
  buildingId!: string;

  @IsDateString({ strict: true })
  cutoff!: string;
}

export class ConfirmPeriodicChargeDto {
  @IsInt()
  @Min(0)
  version!: number;
}
