import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTagDto {
  @IsString()
  @MinLength(1, { message: '标签名称不能为空' })
  @MaxLength(20, { message: '标签名称最多 20 个字' })
  name: string;

  /** 展示排序，小在前；不传时排在最后 */
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  sort?: number;
}
