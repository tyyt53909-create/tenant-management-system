import { IsString, IsNotEmpty, IsInt, IsDateString, IsOptional, Min } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @IsNotEmpty()
  contractId: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsDateString()
  checkoutDate: string;

  @IsInt()
  @Min(0)
  totalRefund: number; // 分

  @IsString()
  @IsNotEmpty()
  processedBy: string; // 处理人ID

  @IsString()
  @IsOptional()
  notes?: string;
}
