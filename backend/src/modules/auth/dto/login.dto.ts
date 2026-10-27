import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: '邮箱或手机号不能为空' })
  identifier: string; // 邮箱或手机号

  @IsString()
  @MinLength(6, { message: '密码至少6位' })
  @MaxLength(72, { message: '密码最长72位' })
  password: string;
}

export class LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    role: string;
  };
}
