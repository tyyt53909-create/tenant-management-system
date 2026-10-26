import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewCheckoutRequestDto {
  @IsBoolean({ message: '审批结论必须为布尔值 (true: 同意, false: 驳回)' })
  approved: boolean;

  @IsString({ message: '驳回原因必须为字符串' })
  @IsOptional()
  @MaxLength(500, { message: '驳回原因最多500字符' })
  rejectReason?: string;
}
