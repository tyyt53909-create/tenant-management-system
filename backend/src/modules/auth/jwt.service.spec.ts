import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthService, JwtPayload } from './jwt.service';
import jwtConfig from '../../config/jwt.config';

describe('JwtAuthService', () => {
  let service: JwtAuthService;

  beforeEach(async () => {
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
  });

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
    });
  });
});
