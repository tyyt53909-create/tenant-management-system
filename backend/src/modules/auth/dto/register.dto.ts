import { IsEmail, IsString, MinLength, IsNotEmpty, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @IsString()
  @MinLength(6, { message: '密码至少6位' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: '邀请码不能为空' })
  inviteCode: string;

  @IsString()
  @IsNotEmpty({ message: '邮箱验证码不能为空' })
  emailCode: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class RegisterResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}
