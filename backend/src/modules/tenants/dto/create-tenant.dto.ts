import { IsString, IsNotEmpty, IsEmail, IsOptional, Matches, IsArray, ArrayMaxSize } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式错误' })
  phone: string;

  @IsEmail({}, { message: '邮箱格式错误' })
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  emergencyContact?: string;

  @IsString()
  @IsOptional()
  emergencyPhone?: string;

  /**
   * 标签字典 ID 列表（T215）。服务端会校验每个 ID 都存在；
   * 未传表示不改动，传 [] 表示清空。
   */
  @IsArray()
  @ArrayMaxSize(20, { message: '单个租客最多 20 个标签' })
  @IsString({ each: true })
  @IsOptional()
  tagIds?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}
