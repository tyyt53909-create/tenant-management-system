import { IsOptional, IsDateString, IsString } from 'class-validator';

export class SettleMeterDto {
  /** 结算截止时间（默认当前时间） */
  @IsDateString({}, { message: '截止时间格式不正确' })
  @IsOptional()
  settleUntil?: string;

  /** 结算备注 */
  @IsString()
  @IsOptional()
  notes?: string;
}
