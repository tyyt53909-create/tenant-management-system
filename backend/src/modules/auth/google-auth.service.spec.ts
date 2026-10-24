import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google-auth.service.js';
import { BadRequestException } from '@nestjs/common';

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService({
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      // T206：模拟通道改为显式开关（原先只靠 NODE_ENV !== 'production'）
      GOOGLE_AUTH_MOCK: 'true',
      NODE_ENV: 'development',
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

  it('未开启 GOOGLE_AUTH_MOCK 时，mock token 不再被接受（回归 T206）', async () => {
    const closed = new GoogleAuthService(
      new ConfigService({ GOOGLE_CLIENT_ID: 'test-google-client-id', NODE_ENV: 'development' }),
    );

    expect(closed.isMockEnabled()).toBe(false);
    await expect(closed.verifyIdToken('mock-google-token:admin@example.com')).rejects.toThrow(
      /模拟 Google 登录通道未启用/,
    );
  });

  it('生产环境下即使开启 GOOGLE_AUTH_MOCK，mock token 也一律拒绝', async () => {
    const prod = new GoogleAuthService(
      new ConfigService({ GOOGLE_CLIENT_ID: 'test-google-client-id', GOOGLE_AUTH_MOCK: 'true', NODE_ENV: 'production' }),
    );

    expect(prod.isMockEnabled()).toBe(false);
    await expect(prod.verifyIdToken('mock-google-token:admin@example.com')).rejects.toThrow(
      /模拟 Google 登录通道未启用/,
    );
  });

  it('未配置 Client ID 且模拟通道关闭时，给出明确的服务不可用错误', async () => {
    const unconfigured = new GoogleAuthService(new ConfigService({ NODE_ENV: 'development' }));

    await expect(unconfigured.verifyIdToken('real-google-id-token')).rejects.toThrow(
      /未配置 GOOGLE_CLIENT_ID/,
    );
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

  it('真实 token 的 email_verified 必须显式为 true，缺失按未验证处理', async () => {
    const stubPayload = (emailVerified: boolean | undefined) => ({
      getPayload: () => ({
        sub: 'google-sub-real',
        email: 'real@example.com',
        name: 'Real',
        picture: 'https://avatar',
        ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
      }),
    });

    (service as unknown as { client: { verifyIdToken: unknown } }).client = {
      verifyIdToken: vi.fn().mockResolvedValue(stubPayload(undefined)),
    };
    const missing = await service.verifyIdToken('real-token');
    expect(missing.emailVerified).toBe(false);

    (service as unknown as { client: { verifyIdToken: unknown } }).client = {
      verifyIdToken: vi.fn().mockResolvedValue(stubPayload(false)),
    };
    const denied = await service.verifyIdToken('real-token');
    expect(denied.emailVerified).toBe(false);

    (service as unknown as { client: { verifyIdToken: unknown } }).client = {
      verifyIdToken: vi.fn().mockResolvedValue(stubPayload(true)),
    };
    const verified = await service.verifyIdToken('real-token');
    expect(verified.emailVerified).toBe(true);
  });

  it('在开发环境支持默认 mock token 解析', async () => {
    const payload = await service.verifyIdToken('mock-google-token:simple@gmail.com');
    expect(payload.email).toBe('simple@gmail.com');
    expect(payload.name).toBe('simple');
    expect(payload.googleId).toContain('google-sub-');
  });
});
