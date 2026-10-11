import { IsString, IsNotEmpty, IsEmail, IsOptional, Matches } from 'class-validator';

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

  @IsOptional()
  tags?: any; // JSON

  @IsString()
  @IsOptional()
  notes?: string;
}
