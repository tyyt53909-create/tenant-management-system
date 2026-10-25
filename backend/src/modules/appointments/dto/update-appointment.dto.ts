import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmAppointmentDto {
  @IsOptional()
  @IsString({ message: '排期确认备注必须为字符串' })
  @MaxLength(500, { message: '备注最多500字符' })
  notes?: string;
}

export class CompleteAppointmentDto {
  @IsOptional()
  @IsString({ message: '看房反馈必须为字符串' })
  @MaxLength(1000, { message: '反馈内容最多1000字符' })
  feedback?: string;
}

export class CancelAppointmentDto {
  @IsOptional()
  @IsString({ message: '取消原因必须为字符串' })
  @MaxLength(500, { message: '取消原因最多500字符' })
  reason?: string;
}
