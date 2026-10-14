import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GoogleAuthDto {
  @IsNotEmpty({ message: 'Google 凭证 idToken 不能为空' })
  @IsString({ message: 'idToken 必须为字符串' })
  idToken: string;

  @IsOptional()
  @IsString({ message: '邀请码必须为字符串' })
  inviteCode?: string;
}

export class GoogleAuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    role: string;
    avatarUrl?: string | null;
  };
  isNewUser?: boolean;
}
