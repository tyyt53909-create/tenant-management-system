import { IsInt, IsOptional, Min, Max } from 'class-validator';

export class GenerateInviteCodeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650) // 最多10年
  expiryDays?: number = 365;
}
