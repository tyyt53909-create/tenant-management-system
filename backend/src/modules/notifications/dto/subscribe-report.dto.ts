import { IsNotEmpty, IsString, IsIn } from 'class-validator';

export class SubscribeReportDto {
  @IsString()
  @IsNotEmpty({ message: '模板ID不能为空' })
  templateId: string;

  @IsString()
  @IsIn(['accept', 'reject', 'ban'], {
    message: '授权结果必须为 accept、reject 或 ban',
  })
  action: 'accept' | 'reject' | 'ban';
}
