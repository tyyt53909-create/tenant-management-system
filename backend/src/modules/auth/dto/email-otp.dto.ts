import { IsEmail, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class SendEmailCodeDto {
  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;
}

export class LoginEmailCodeDto {
  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsNotEmpty({ message: '验证码不能为空' })
  @IsString({ message: '验证码必须为字符串' })
  @Length(6, 6, { message: '验证码必须为6位数字' })
  code: string;

  /** 首次登录必须携带邀请码（DEC-03：禁止自动成为租客）。 */
  @IsOptional()
  @IsString({ message: '邀请码必须为字符串' })
  inviteCode?: string;
}

export class BindInviteCodeDto {
  @IsNotEmpty({ message: '邀请码不能为空' })
  @IsString({ message: '邀请码必须为字符串' })
  inviteCode: string;
}
