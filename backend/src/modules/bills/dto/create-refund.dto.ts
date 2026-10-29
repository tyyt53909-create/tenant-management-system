import { IsInt, IsOptional, IsString, Min, MinLength, MaxLength } from 'class-validator';

export class CreateRefundDto {
  /** 同一退款申请重试时必须使用同一请求键 */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  requestKey!: string;

  /** 退款金额（单位：分，可选；默认整笔未退金额） */
  @IsOptional()
  @IsInt({ message: '退款金额必须为整数（单位：分）' })
  @Min(1, { message: '退款金额必须大于 0' })
  amount?: number;

  /** 退款原因说明 */
  @IsOptional()
  @IsString({ message: '退款原因必须为字符串' })
  reason?: string;
}
