import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @IsNotEmpty({ message: '微信登录 code 不能为空' })
  code: string;
}

export class WechatBindDto {
  @IsString()
  @IsNotEmpty({ message: '绑定凭证 bindTicket 不能为空' })
  bindTicket: string;

  @IsOptional()
  @IsString()
  inviteCode?: string;

  @IsOptional()
  @IsString()
  phoneCode?: string;
}

export class WechatLoginResponseDto {
  isBound: boolean;
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    email: string | null;
    phone: string | null;
    role: string;
    avatarUrl?: string | null;
  };
  bindTicket?: string;
}
