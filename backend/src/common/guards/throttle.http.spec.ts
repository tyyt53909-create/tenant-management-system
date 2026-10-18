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

const LIMIT_KEYS = [
  'THROTTLE_GLOBAL_LIMIT',
  'THROTTLE_AUTH_LIMIT',
  'THROTTLE_OTP_LIMIT',
  'THROTTLE_OTP_IP_LIMIT',
] as const;

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
    process.env.THROTTLE_OTP_IP_LIMIT = '3';

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
    // 每次换一个来源 IP，只考验「按邮箱」这一层（每 IP 上限另有测试）
    let ipSeq = 0;
    const send = (email: string) =>
      request(app.getHttpServer())
        .post('/api/auth/send-email-code')
        .set('X-Forwarded-For', `203.0.113.${100 + ipSeq++}`)
        .send({ email });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await send('tenant@example.com');
      expect(res.status).not.toBe(429);
    }

    const blocked = await send('tenant@example.com');
    expect(blocked.status).toBe(429);
    // 具名限流器的等待时间带后缀（@nestjs/throttler 的 getThrottlerSuffix），
    // 邮箱维度被挡时头是 Retry-After-otpEmail，IP 维度被挡时才是 Retry-After。
    expect(Number(blocked.headers['retry-after-otpemail'])).toBeGreaterThan(0);

    const other = await send('other@example.com');
    expect(other.status).not.toBe(429);
  });

  it('发送验证码按 IP 限流：换邮箱也不能绕（回归 T206）', async () => {
    const send = (email: string, forwardedFor: string) =>
      request(app.getHttpServer())
        .post('/api/auth/send-email-code')
        .set('X-Forwarded-For', forwardedFor)
        .send({ email });

    const ip = '198.51.100.77';
    for (let i = 0; i < 3; i += 1) {
      const res = await send(`victim${i}@example.com`, ip);
      expect(res.status).not.toBe(429);
    }

    // 第 4 个不同的收件邮箱：邮箱维度没超，但同一 IP 已到上限
    const blocked = await send('victim3@example.com', ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // 换一个 IP 仍然可以发（限流是按 IP 计数，不是全局锁死）
    const otherIp = await send('victim3@example.com', '198.51.100.78');
    expect(otherIp.status).not.toBe(429);
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
    const handlers = AuthController.prototype as unknown as Record<string, object>;
    for (const name of limited) {
      const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handlers[name]);
      expect(typeof limit).toBe('function');
    }
  });

  it('发送验证码：邮箱计数走命名限流器，且没有顶掉 default 的 IP tracker', () => {
    const handlers = AuthController.prototype as unknown as Record<string, object>;
    const sendEmailCode = handlers.sendEmailCode;

    // 邮箱维度：命名限流器 otpEmail 被收紧（tracker 由模块配置提供）
    expect(typeof Reflect.getMetadata('THROTTLER:LIMITotpEmail', sendEmailCode)).toBe('function');
    expect(typeof Reflect.getMetadata('THROTTLER:TTLotpEmail', sendEmailCode)).toBe('function');

    // IP 维度：default 也被收紧，但**不能**挂 tracker —— 一旦挂了，guard 就会用它
    // 取代 commonOptions 的 IP tracker，按 IP 限流随之失效（T206 修的正是这一点）
    expect(typeof Reflect.getMetadata('THROTTLER:LIMITdefault', sendEmailCode)).toBe('function');
    expect(Reflect.getMetadata('THROTTLER:TRACKERdefault', sendEmailCode)).toBeUndefined();
  });
});
