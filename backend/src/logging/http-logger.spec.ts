import { Controller, INestApplication, Post, Req } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpLogger } from './http-logger.js';

@Controller('auth')
class LogProbeController {
  @Post('login')
  login(@Req() req: { user?: { userId: string } }) {
    req.user = { userId: 'user-7' };
    return { ok: true };
  }
}

describe('访问日志', () => {
  let app: INestApplication;
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [LogProbeController] }).compile();
    app = module.createNestApplication();
    app.use(createHttpLogger(stream));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('每条请求带 requestId、userId、耗时和状态码，且不含密码、token、验证码', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Authorization', 'Bearer secret-token-value')
      .set('X-Request-Id', 'req-log-1')
      .send({ password: 'secret-password', code: '654321' });

    expect(response.status).toBe(201);
    expect(response.headers['x-request-id']).toBe('req-log-1');
    const entry = lines
      .flatMap((chunk) => chunk.split('\n'))
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
      .find((item) => item.requestId === 'req-log-1');
    expect(entry).toMatchObject({
      requestId: 'req-log-1',
      userId: 'user-7',
      res: { statusCode: 201 },
    });
    expect(typeof entry.responseTime).toBe('number');
    const text = JSON.stringify(entry);
    expect(text).not.toContain('secret-password');
    expect(text).not.toContain('secret-token-value');
    expect(text).not.toContain('654321');
    expect(text).toContain('[Redacted]');
  });
});
