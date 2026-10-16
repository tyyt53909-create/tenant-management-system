import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthThrottle, OtpEmailThrottle } from '../decorators/throttle.decorators.js';
import { createThrottleModuleOptions } from '../../config/throttle.config.js';
import { AuthController } from '../../modules/auth/auth.controller.js';

@Controller('auth')
class ThrottleProbeController {
  @Post('login')
  @AuthThrottle()
  login() {
    return { ok: true };
  }

  @Post('send-email-code')
  @OtpEmailThrottle()
  sendCode() {
    return { ok: true };
  }

  @Get('ping')
  ping() {
    return { ok: true };
  }
}

const LIMIT_KEYS = ['THROTTLE_GLOBAL_LIMIT', 'THROTTLE_AUTH_LIMIT', 'THROTTLE_OTP_LIMIT'] as const;

describe('限流 HTTP', () => {
  let app: INestApplication;
  const previous: Partial<Record<(typeof LIMIT_KEYS)[number], string | undefined>> = {};

  beforeAll(async () => {
    for (const key of LIMIT_KEYS) {
      previous[key] = process.env[key];
    }
    process.env.THROTTLE_GLOBAL_LIMIT = '3';
    process.env.THROTTLE_AUTH_LIMIT = '10';
    process.env.THROTTLE_OTP_LIMIT = '5';

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(createThrottleModuleOptions())],
      controllers: [ThrottleProbeController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const key of LIMIT_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  });

  it('同一 IP 第 11 次登录返回 429，并带 Retry-After', async () => {
    const login = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({});

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await login()).status).not.toBe(429);
    }

    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('同一邮箱第 6 次发送验证码返回 429，另一个邮箱不受影响', async () => {
    const send = (email: string) =>
      request(app.getHttpServer()).post('/api/auth/send-email-code').send({ email });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await send('tenant@example.com');
      expect(res.status).not.toBe(429);
    }

    const blocked = await send('tenant@example.com');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    const other = await send('other@example.com');
    expect(other.status).not.toBe(429);
  });

  it('普通接口按 IP 适用全局限流，代理后的不同来源分开计数', async () => {
    const ping = (forwardedFor: string) =>
      request(app.getHttpServer()).get('/api/auth/ping').set('X-Forwarded-For', forwardedFor);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await ping('198.51.100.8')).status).not.toBe(429);
    }
    expect((await ping('198.51.100.8')).status).toBe(429);
    expect((await ping('198.51.100.9')).status).not.toBe(429);
  });
});

describe('AuthController 限流装饰器', () => {
  const limited = ['register', 'login', 'googleAuth', 'loginWithEmailCode', 'bindInviteCode'] as const;

  it('敏感认证接口覆盖了 default 限流次数', () => {
    const handlers = AuthController.prototype as unknown as Record<string, unknown>;
    for (const name of limited) {
      const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handlers[name]);
      expect(typeof limit).toBe('function');
    }
  });

  it('发送验证码按邮箱跟踪', () => {
    const handlers = AuthController.prototype as unknown as Record<string, unknown>;
    const tracker = Reflect.getMetadata('THROTTLER:TRACKERdefault', handlers.sendEmailCode);
    expect(typeof tracker).toBe('function');
  });
});
