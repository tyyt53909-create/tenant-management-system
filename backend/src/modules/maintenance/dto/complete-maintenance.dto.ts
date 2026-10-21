import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CompleteMaintenanceDto {
  /** 维修人员填写的处理结果；完工提交时必填（T225）。 */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: '请填写解决方案' })
  @MaxLength(2000, { message: '解决方案不能超过 2000 字' })
  resolution: string;
}
