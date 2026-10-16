import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthService, JwtPayload } from './jwt.service.js';
import { MemoryRefreshSessionStore } from './refresh-session.store.js';
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

    it('同一个 refresh token 使用两次后，该用户全部会话失效', async () => {
      const rotating = rotatingService();
      const first = await rotating.generateTokens({ sub: 'user-123', role: 'TENANT' });
      const second = await rotating.generateTokens({ sub: 'user-123', role: 'ADMIN' });
      const rotated = await rotating.rotateRefreshToken(first.refreshToken);
      await expect(rotating.rotateRefreshToken(first.refreshToken)).rejects.toThrow(/所有会话已失效/);
      await expect(rotating.rotateRefreshToken(rotated.refreshToken)).rejects.toThrow(/无效或已过期/);
      await expect(rotating.rotateRefreshToken(second.refreshToken)).rejects.toThrow(/无效或已过期/);
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
