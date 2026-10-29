import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RentReportDto {
  @IsString()
  @IsNotEmpty()
  buildingId: string;

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month: string;
}
