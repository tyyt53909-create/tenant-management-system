import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AcceptCleaningDto {
  @IsOptional()
  @IsInt({ message: '评分必须是整数' })
  @Min(1, { message: '评分最低为 1' })
  @Max(5, { message: '评分最高为 5' })
  rating?: number;

  @IsOptional()
  @IsString({ message: '验收评语必须是字符串' })
  acceptanceNotes?: string;
}

export class RejectCleaningDto {
  @IsOptional()
  @IsString({ message: '驳回原因必须是字符串' })
  reason?: string;
}
