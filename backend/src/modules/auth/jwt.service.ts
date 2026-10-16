import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import {
  newSessionId,
  REFRESH_STORE,
  type RefreshSessionStore,
} from './refresh-session.store.js';

export interface JwtPayload {
  sub: string;        // userId
  role?: string;      // UserRole
  buildingId?: string; // 可选，租客绑定的楼栋
  tokenType?: 'ACCESS' | 'REFRESH'; // 明确区分 Token 用途（防止混用绕过有效期）
  jti?: string;
  familyId?: string;
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
    @Optional() @Inject(REFRESH_STORE) private readonly sessions?: RefreshSessionStore,
  ) {}

  /**
   * 生成 Access Token 和 Refresh Token（严格嵌入 tokenType）
   */
  async generateTokens(payload: JwtPayload): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      { ...payload, tokenType: 'ACCESS' },
      {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.accessTokenExpiry'),
      },
    );

    const jti = newSessionId();
    const familyId = newSessionId();
    const refreshToken = await this.signRefresh(payload.sub, jti, familyId);
    if (this.sessions) {
      await this.sessions.save({
        jti,
        userId: payload.sub,
        familyId,
        expiresAt: Date.now() + this.refreshTtlMs(),
        status: 'active',
      });
    }

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
    // 验证并强制检查 Refresh Token 用途
    const verified = await this.verifyToken(refreshToken);
    if (verified.tokenType !== 'REFRESH') {
      throw new UnauthorizedException('无效的 Refresh Token，禁止用于刷新');
    }

    // 生成新的 Access Token（固定 tokenType: ACCESS）
    return this.jwtService.signAsync(
      { ...payload, tokenType: 'ACCESS' },
      {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.accessTokenExpiry'),
      },
    );
  }

  /**
   * 轮换 Refresh Token。旧 token 再使用视为偷用，并撤销该用户全部会话。
   */
  async rotateRefreshToken(refreshToken: string): Promise<TokenPair> {
    const verified = await this.verifyToken(refreshToken);
    if (verified.tokenType !== 'REFRESH' || !verified.jti || !verified.familyId) {
      throw new UnauthorizedException('无效的 Refresh Token，禁止用于刷新');
    }
    if (!this.sessions) {
      throw new UnauthorizedException('登录会话不可用');
    }

    const current = await this.sessions.get(verified.jti);
    if (!current) {
      throw new UnauthorizedException('Token 无效或已过期');
    }
    if (current.status === 'rotated') {
      await this.sessions.revokeUser(current.userId);
      throw new UnauthorizedException('刷新令牌已重复使用，所有会话已失效');
    }

    const nextJti = newSessionId();
    const accessToken = await this.signAccess({ sub: verified.sub, role: verified.role });
    const nextRefresh = await this.signRefresh(verified.sub, nextJti, current.familyId);
    await this.sessions.save({
      jti: nextJti,
      userId: current.userId,
      familyId: current.familyId,
      expiresAt: Date.now() + this.refreshTtlMs(),
      status: 'active',
    });
    await this.sessions.save({ ...current, status: 'rotated', replacedBy: nextJti });
    return { accessToken, refreshToken: nextRefresh };
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const verified = await this.verifyToken(refreshToken);
    if (verified.tokenType !== 'REFRESH' || !verified.jti || !this.sessions) {
      throw new UnauthorizedException('Token 无效或已过期');
    }
    const current = await this.sessions.get(verified.jti);
    if (!current) return;
    await this.sessions.revokeFamily(current.userId, current.familyId);
  }

  async revokeUserSessions(userId: string): Promise<void> {
    await this.sessions?.revokeUser(userId);
  }

  private signAccess(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(
      { ...payload, tokenType: 'ACCESS' },
      {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.accessTokenExpiry'),
      },
    );
  }

  private signRefresh(userId: string, jti: string, familyId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, tokenType: 'REFRESH', jti, familyId },
      {
        secret: this.configService.get('jwt.secret'),
        expiresIn: this.configService.get('jwt.refreshTokenExpiry'),
      },
    );
  }

  private refreshTtlMs(): number {
    const raw = this.configService.get<string>('jwt.refreshTokenExpiry') || '7d';
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const amount = Number(match[1]);
    const unit = match[2];
    const scale = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return amount * scale;
  }
}
