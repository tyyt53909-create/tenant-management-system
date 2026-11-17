import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class ConfirmMeterHandoffDto {
  @ApiProperty({ description: '交接时旧表末数或回零前末数' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  previousFinal!: number;

  @ApiProperty({ description: '同一交接时刻的新表底数，必须等于该条已采集的读数' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  newOpening!: number;
}
