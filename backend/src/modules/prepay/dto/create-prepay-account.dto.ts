import { IsString, IsNotEmpty, IsInt, IsOptional, Min } from 'class-validator';

export class CreatePrepayAccountDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  lowBalanceThreshold?: number; // 分
}
