import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GooglePayload {
  googleId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  emailVerified: boolean;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private client: OAuth2Client;
  private readonly clientId: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    this.client = new OAuth2Client(this.clientId);
  }

  getClientId(): string {
    return this.clientId || '';
  }

  async verifyIdToken(idToken: string): Promise<GooglePayload> {
    if (!idToken || typeof idToken !== 'string') {
      throw new BadRequestException('无效的 Google idToken');
    }

    // 开发与测试环境 Mock Token 支持（格式: mock-google-token:email[:name[:googleId]]）
    if (
      this.configService.get<string>('NODE_ENV') !== 'production' &&
      (idToken.startsWith('mock-google-token:') || !this.clientId || this.clientId === 'your-google-client-id-here')
    ) {
      return this.verifyMockToken(idToken);
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new BadRequestException('Google 凭证缺少必要的用户信息 (sub/email)');
      }
      return {
        googleId: payload.sub,
        email: payload.email.toLowerCase(),
        name: payload.name || payload.email.split('@')[0],
        avatarUrl: payload.picture,
        emailVerified: payload.email_verified ?? true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Google Token 验证失败: ${message}`);
      throw new UnauthorizedException(`Google 身份凭证无效或已过期: ${message}`);
    }
  }

  private verifyMockToken(idToken: string): GooglePayload {
    if (idToken.startsWith('mock-google-token:')) {
      const parts = idToken.split(':');
      const email = parts[1] || 'google_user@example.com';
      const name = parts[2] || email.split('@')[0];
      const googleId = parts[3] || `google-sub-${Buffer.from(email).toString('hex').slice(0, 16)}`;
      return {
        googleId,
        email: email.toLowerCase(),
        name,
        avatarUrl: 'https://lh3.googleusercontent.com/a/default-avatar',
        emailVerified: true,
      };
    }

    return {
      googleId: `google-sub-${Date.now()}`,
      email: 'dev.google.tenant@example.com',
      name: 'Google 测试租客',
      avatarUrl: 'https://lh3.googleusercontent.com/a/default-avatar',
      emailVerified: true,
    };
  }
}
