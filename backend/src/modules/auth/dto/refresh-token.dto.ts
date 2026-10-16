import { IsString, IsOptional } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class RefreshTokenResponseDto {
  accessToken: string;
  refreshToken: string;
}
