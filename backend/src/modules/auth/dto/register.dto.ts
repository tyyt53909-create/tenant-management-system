import { IsEmail, IsString, MinLength, MaxLength, Matches, IsNotEmpty, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsNotEmpty({ message: '邮箱不能为空' })
  email: string;

  @IsString()
  @MinLength(8, { message: '密码至少8位，且须同时包含字母和数字' })
  @MaxLength(72, { message: '密码最长72位' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码至少8位，且须同时包含字母和数字' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: '邀请码不能为空' })
  inviteCode: string;

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
