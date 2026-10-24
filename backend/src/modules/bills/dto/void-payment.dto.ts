import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 作废收款（生成冲正） */
export class VoidPaymentDto {
  @IsString()
  @IsNotEmpty({ message: '作废原因不能为空' })
  @MaxLength(500, { message: '作废原因过长' })
  reason: string;
}
