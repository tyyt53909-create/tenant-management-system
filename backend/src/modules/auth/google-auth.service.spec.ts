import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service.js';
import { BadRequestException } from '@nestjs/common';

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService({
      GOOGLE_CLIENT_ID: 'test-google-client-id',
    });
    service = new GoogleAuthService(configService);
  });

  it('应该能获取配置的 Client ID', () => {
    expect(service.getClientId()).toBe('test-google-client-id');
  });

  it('非空校验：传入空 Token 应该抛出 BadRequestException', async () => {
    await expect(service.verifyIdToken('')).rejects.toThrow(BadRequestException);
    await expect(service.verifyIdToken(null as any)).rejects.toThrow(BadRequestException);
  });

  it('在开发/测试环境下支持自定义 mock token 解析', async () => {
    const payload = await service.verifyIdToken(
      'mock-google-token:tenant_google@gmail.com:GoogleTenant:sub-998877',
    );
    expect(payload.email).toBe('tenant_google@gmail.com');
    expect(payload.name).toBe('GoogleTenant');
    expect(payload.googleId).toBe('sub-998877');
    expect(payload.emailVerified).toBe(true);
  });

  it('在开发环境支持默认 mock token 解析', async () => {
    const payload = await service.verifyIdToken('mock-google-token:simple@gmail.com');
    expect(payload.email).toBe('simple@gmail.com');
    expect(payload.name).toBe('simple');
    expect(payload.googleId).toContain('google-sub-');
  });
});
