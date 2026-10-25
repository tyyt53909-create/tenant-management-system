import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { durationMsOr } from '../../common/utils/duration.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import {
  newSessionId,
  REFRESH_STORE,
  type RefreshSessionStore,
} from './refresh-session.store.js';

/**
 * 并发刷新的宽限窗口（T208）。
 *
 * 同一个 refresh token 在极短时间内被再次使用，多半是「多标签页/并发 401 同时刷新」
 * 这类竞态；只有明显超出这个窗口的重放才按令牌泄露处理（撤销整个会话家族）。
 */
const ROTATION_RACE_GRACE_MS = 30_000;

/** 只允许 HS256，避免算法混淆（alg=none / RS256 公钥当 HMAC 密钥）。 */
const JWT_ALGORITHM = 'HS256';
const DEFAULT_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
        algorithm: JWT_ALGORITHM,
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
      algorithms: [JWT_ALGORITHM],
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
        algorithm: JWT_ALGORITHM,
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

    const nextJti = newSessionId();
    const accessToken = await this.signAccess({ sub: verified.sub, role: verified.role });
    const nextRefresh = await this.signRefresh(verified.sub, nextJti, current.familyId);

    // 原子轮换（T208）：并发刷新时只有一个请求能赢，输的那个不再把整个会话家族撤销。
    // 原先「get → 判断 rotated → save」三步非原子，两个并发请求都会通过判断；
    // 而管理后台多标签页、小程序首屏并发 401 都会真的并发刷新 —— 结果是用户被强制登出。
    const rotation = await this.sessions.rotate(verified.jti, nextJti);
    if (!rotation.rotated) {
      // 判定基准必须取 rotate 的结果，不能用上面那份 `current` 快照：
      // 真实并发时两个请求都在任何人轮换之前读完会话，快照里没有 rotatedAt，
      // 用它判断会让输家永远落进「重放」分支，把赢家刚签发的新会话一起撤销（T208 补修）。
      const withinGrace =
        rotation.rotatedAt > 0 && Date.now() - rotation.rotatedAt <= ROTATION_RACE_GRACE_MS;
      if (withinGrace) {
        // 刚刚被别的请求轮换过：并发竞态，不销毁会话家族，让客户端按错误码重试一次
        // （COM-05 / T285：客户端只认 code，不再匹配中文 message）
        throw apiError(ErrorCode.AUTH_REFRESH_ROTATING);
      }
      // 超出宽限窗口仍在使用已轮换的令牌 → 视为重放（令牌可能已泄露）
      await this.sessions.revokeUser(current.userId);
      throw new UnauthorizedException('刷新令牌已重复使用，所有会话已失效');
    }

    await this.sessions.save({
      jti: nextJti,
      userId: current.userId,
      familyId: current.familyId,
      expiresAt: Date.now() + this.refreshTtlMs(),
      status: 'active',
    });
    return { accessToken, refreshToken: nextRefresh };
  }

  /**
   * 撤销 Refresh Token。**幂等**：无效/过期/类型不符/已撤销的令牌都视为
   * 「已经登出」直接返回，登出接口不会因为令牌过期而回 500/401（ISS-26）。
   * Redis/存储异常仍会抛出，避免把真实故障吞掉。
   */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    let verified: JwtPayload;
    try {
      verified = await this.verifyToken(refreshToken);
    } catch {
      return;
    }
    if (verified.tokenType !== 'REFRESH' || !verified.jti || !this.sessions) {
      return;
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
        algorithm: JWT_ALGORITHM,
        expiresIn: this.configService.get('jwt.accessTokenExpiry'),
      },
    );
  }

  private signRefresh(userId: string, jti: string, familyId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, tokenType: 'REFRESH', jti, familyId },
      {
        secret: this.configService.get('jwt.secret'),
        algorithm: JWT_ALGORITHM,
        expiresIn: this.configService.get('jwt.refreshTokenExpiry'),
      },
    );
  }

  private refreshTtlMs(): number {
    return durationMsOr(
      this.configService.get<string>('jwt.refreshTokenExpiry'),
      DEFAULT_REFRESH_TTL_MS,
    );
  }
}
