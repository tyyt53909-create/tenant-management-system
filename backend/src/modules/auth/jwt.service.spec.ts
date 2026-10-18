import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthService, JwtPayload } from './jwt.service.js';
import {
  MemoryRefreshSessionStore,
  type RefreshSession,
  type RefreshSessionStore,
} from './refresh-session.store.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import jwtConfig from '../../config/jwt.config.js';
import { vi } from 'vitest';

describe('JwtAuthService', () => {
  let service: JwtAuthService;
  let jwt: JwtService;
  let config: ConfigService;

  beforeEach(async () => {
    // 单元测试不依赖未跟踪的 .env，也不读取真实运行密钥。
    vi.stubEnv('JWT_SECRET', 'unit-test-only-jwt-secret-not-for-runtime');
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [jwtConfig],
        }),
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [JwtAuthService],
    }).compile();

    service = module.get<JwtAuthService>(JwtAuthService);
    jwt = module.get(JwtService);
    config = module.get(ConfigService);
  });

  function rotatingService() {
    return new JwtAuthService(jwt, config, new MemoryRefreshSessionStore());
  }

  afterEach(() => vi.unstubAllEnvs());

  it('应该定义服务', () => {
    expect(service).toBeDefined();
  });

  describe('generateTokens', () => {
    it('应该生成 Access Token 和 Refresh Token', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        role: 'ADMIN',
      };

      const tokens = await service.generateTokens(payload);

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(typeof tokens.accessToken).toBe('string');
      expect(typeof tokens.refreshToken).toBe('string');
    });
  });

  describe('verifyToken', () => {
    it('应该验证有效的 Token', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        role: 'ADMIN',
      };

      const tokens = await service.generateTokens(payload);
      const verified = await service.verifyToken(tokens.accessToken);

      expect(verified.sub).toBe('user-123');
      expect(verified.role).toBe('ADMIN');
    });

    it('应该拒绝无效的 Token', async () => {
      await expect(service.verifyToken('invalid-token')).rejects.toThrow();
    });
  });

  describe('refreshAccessToken', () => {
    it('应该从 Refresh Token 生成新的 Access Token', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        role: 'ADMIN',
      };

      const tokens = await service.generateTokens(payload);
      const newAccessToken = await service.refreshAccessToken(
        tokens.refreshToken,
        payload,
      );

      expect(newAccessToken).toBeDefined();
      expect(typeof newAccessToken).toBe('string');

      const verified = await service.verifyToken(newAccessToken);
      expect(verified.sub).toBe('user-123');
      expect(verified.tokenType).toBe('ACCESS');
    });

    it('登出后旧 refresh token 不能再刷新', async () => {
      const rotating = rotatingService();
      const tokens = await rotating.generateTokens({ sub: 'user-123', role: 'TENANT' });
      await rotating.revokeRefreshToken(tokens.refreshToken);
      await expect(rotating.rotateRefreshToken(tokens.refreshToken)).rejects.toThrow(/无效或已过期/);
    });

    it('并发刷新（宽限窗口内重复使用）→ 只报「正在轮换中」，不销毁会话家族（回归 T208）', async () => {
      const rotating = rotatingService();
      const first = await rotating.generateTokens({ sub: 'user-123', role: 'TENANT' });
      const rotated = await rotating.rotateRefreshToken(first.refreshToken);

      // 第二个并发请求带着同一个（已被轮换的）令牌进来
      await expect(rotating.rotateRefreshToken(first.refreshToken)).rejects.toThrow(/正在轮换中/);
      // 关键：刚发出的新令牌仍然可用，用户不会被强制登出
      await expect(rotating.rotateRefreshToken(rotated.refreshToken)).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    it('真并发（两个请求都在轮换前读完会话）→ 输家只报「正在轮换中」，赢家的新令牌仍可用（T208 补修）', async () => {
      const inner = new MemoryRefreshSessionStore();
      let snapshot: RefreshSession | undefined;
      let getCalls = 0;
      // 前两次 get 返回同一份 active 快照：真实并发下两个请求都会在任何人 rotate 之前读完会话
      const racing: RefreshSessionStore = {
        save: (s) => inner.save(s),
        get: async (jti) => {
          getCalls += 1;
          const real = await inner.get(jti);
          if (getCalls <= 2 && real) snapshot = { ...real };
          return getCalls <= 2 ? snapshot : real;
        },
        rotate: (jti, next) => inner.rotate(jti, next),
        revokeFamily: (u, f) => inner.revokeFamily(u, f),
        revokeUser: (u) => inner.revokeUser(u),
      };

      const rotating = new JwtAuthService(jwt, config, racing);
      const first = await rotating.generateTokens({ sub: 'user-123', role: 'TENANT' });

      const [a, b] = await Promise.allSettled([
        rotating.rotateRefreshToken(first.refreshToken),
        rotating.rotateRefreshToken(first.refreshToken),
      ]);

      const winner = a.status === 'fulfilled' ? a.value : (b as PromiseFulfilledResult<any>).value;
      const loser = a.status === 'rejected' ? a.reason : (b as PromiseRejectedResult).reason;

      // 输家必须识别为竞态而不是重放：旧快照里没有 rotatedAt，判定只能来自 rotate 的返回值
      expect(loser?.message).toMatch(/正在轮换中/);
      // 赢家刚签发的新令牌必须仍然生效（不能被输家撤销掉整个会话家族）
      await expect(rotating.rotateRefreshToken(winner.refreshToken)).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    it('超出宽限窗口仍使用已轮换的令牌 → 视为重放，该用户全部会话失效', async () => {
      const base = new Date('2026-10-18T10:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(base);
      try {
        const rotating = rotatingService();
        const first = await rotating.generateTokens({ sub: 'user-123', role: 'TENANT' });
        const second = await rotating.generateTokens({ sub: 'user-123', role: 'ADMIN' });
        const rotated = await rotating.rotateRefreshToken(first.refreshToken);

        // 31 秒后再次使用旧的（已轮换）令牌
        vi.setSystemTime(new Date(base.getTime() + 31_000));
        await expect(rotating.rotateRefreshToken(first.refreshToken)).rejects.toThrow(/所有会话已失效/);
        await expect(rotating.rotateRefreshToken(rotated.refreshToken)).rejects.toThrow(/无效或已过期/);
        await expect(rotating.rotateRefreshToken(second.refreshToken)).rejects.toThrow(/无效或已过期/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('禁止使用 Access Token 作为 Refresh Token 刷新（防混用）', async () => {
      const payload: JwtPayload = {
        sub: 'user-123',
        role: 'ADMIN',
      };

      const tokens = await service.generateTokens(payload);
      await expect(
        service.refreshAccessToken(tokens.accessToken, payload),
      ).rejects.toThrow();
    });
  });
});
