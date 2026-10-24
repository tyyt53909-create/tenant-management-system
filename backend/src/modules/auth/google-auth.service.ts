import { Injectable, BadRequestException, UnauthorizedException, ServiceUnavailableException, Logger } from '@nestjs/common';
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

  /**
   * 模拟通道是否可用（T206）。
   *
   * 原先只以 `NODE_ENV !== 'production'` 把关：部署漏设 NODE_ENV（staging/typo/未设）且没配
   * GOOGLE_CLIENT_ID 时，`POST /auth/google {"idToken":"mock-google-token:admin@example.com"}`
   * 就能冒充既有账号。现在改成与 OTP 万能码同级的**显式开关**：必须 GOOGLE_AUTH_MOCK=true，
   * 且 NODE_ENV 不是 production。
   */
  isMockEnabled(): boolean {
    return (
      this.configService.get<string>('GOOGLE_AUTH_MOCK') === 'true' &&
      this.configService.get<string>('NODE_ENV') !== 'production'
    );
  }

  async verifyIdToken(idToken: string): Promise<GooglePayload> {
    if (!idToken || typeof idToken !== 'string') {
      throw new BadRequestException('无效的 Google idToken');
    }

    const isMockToken = idToken.startsWith('mock-google-token:');
    if (isMockToken && !this.isMockEnabled()) {
      throw new UnauthorizedException(
        '模拟 Google 登录通道未启用（需 GOOGLE_AUTH_MOCK=true 且 NODE_ENV 非 production）',
      );
    }

    // 开发与测试环境 Mock Token 支持（格式: mock-google-token:email[:name[:googleId]]）
    if (
      this.isMockEnabled() &&
      (isMockToken || !this.clientId || this.clientId === 'your-google-client-id-here')
    ) {
      return this.verifyMockToken(idToken);
    }

    // 未配置 Client ID 且模拟通道关闭：明确报错，不要静默按 mock 处理
    if (!this.clientId || this.clientId === 'your-google-client-id-here') {
      throw new ServiceUnavailableException(
        '服务端未配置 GOOGLE_CLIENT_ID，Google 登录不可用（开发环境可设 GOOGLE_AUTH_MOCK=true 启用模拟通道）',
      );
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
        emailVerified: payload.email_verified === true,
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
