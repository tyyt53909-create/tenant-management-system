import { IsOptional, IsEnum, IsString, MaxLength } from 'class-validator';
import { LeadStatus } from '@prisma/client';

export class UpdateLeadDto {
  @IsOptional()
  @IsEnum(LeadStatus, { message: '线索状态无效' })
  status?: LeadStatus;

  @IsOptional()
  @IsString({ message: '跟进备注必须为字符串' })
  @MaxLength(1000, { message: '跟进备注最多1000字符' })
  notes?: string;

  @IsOptional()
  @IsString({ message: '跟进人 ID 必须为字符串' })
  followUpBy?: string;
}
