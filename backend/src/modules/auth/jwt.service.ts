import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwtService } from '@nestjs/jwt';

export interface JwtPayload {
  sub: string;        // userId
  role: string;       // UserRole
  buildingId?: string; // 可选，租客绑定的楼栋
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class JwtAuthService {
  constructor(
    private readonly jwtService: NestJwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 生成 Access Token 和 Refresh Token
   */
  async generateTokens(payload: JwtPayload): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.accessTokenExpiry'),
    });

    const refreshToken = await this.jwtService.signAsync(
      { sub: payload.sub },
      {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.refreshTokenExpiry'),
      },
    );

    return { accessToken, refreshToken };
  }

  /**
   * 验证 Token
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.configService.get('jwt.secret'),
    });
  }

  /**
   * 从 Refresh Token 生成新的 Access Token
   */
  async refreshAccessToken(refreshToken: string, payload: JwtPayload): Promise<string> {
    // 验证 Refresh Token
    await this.verifyToken(refreshToken);

    // 生成新的 Access Token
    return this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt.secret'),
      expiresIn: this.configService.get('jwt.accessTokenExpiry'),
    });
  }
}
