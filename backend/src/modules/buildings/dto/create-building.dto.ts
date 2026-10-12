import { IsString, IsNotEmpty, IsInt, IsOptional, Min } from 'class-validator';

export class CreateBuildingDto {
  @IsString()
  @IsNotEmpty({ message: '楼栋名称不能为空' })
  name: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsInt()
  @Min(1, { message: '楼层数至少为1' })
  floors: number;

  @IsOptional()
  metadata?: any;
}
