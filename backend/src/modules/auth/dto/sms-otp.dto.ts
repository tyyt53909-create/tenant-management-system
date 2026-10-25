import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class SendSmsCodeDto {
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入有效的11位国内手机号' })
  phone: string;
}

export class LoginSmsCodeDto {
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入有效的11位国内手机号' })
  phone: string;

  @IsNotEmpty({ message: '验证码不能为空' })
  @IsString({ message: '验证码必须为字符串' })
  @Length(6, 6, { message: '验证码必须为6位数字' })
  code: string;

  /** 首次登录必须携带邀请码（DEC-03：禁止自动成为租客）。 */
  @IsOptional()
  @IsString({ message: '邀请码必须为字符串' })
  inviteCode?: string;
}

export class BindPhoneSmsDto {
  @IsNotEmpty({ message: '手机号不能为空' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入有效的11位国内手机号' })
  phone: string;

  @IsNotEmpty({ message: '验证码不能为空' })
  @IsString({ message: '验证码必须为字符串' })
  @Length(6, 6, { message: '验证码必须为6位数字' })
  code: string;
}
