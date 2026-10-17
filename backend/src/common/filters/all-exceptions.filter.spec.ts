import { BadRequestException, Controller, ForbiddenException, Get, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter, requestIdMiddleware } from './all-exceptions.filter.js';

@Controller('probe')
class ProbeController {
  @Get('validation')
  validation() {
    throw new BadRequestException(['邮箱不能为空', '邮箱格式不正确']);
  }

  @Get('credentials')
  credentials() {
    throw new UnauthorizedException('邮箱/手机号或密码错误');
  }

  @Get('capability')
  capability() {
    throw new ForbiddenException('CAPABILITY_DENIED');
  }

  @Get('conflict')
  conflict() {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['email'] },
    });
  }

  @Get('missing')
  missing() {
    throw new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: '5.22.0',
    });
  }

  @Get('boom')
  boom() {
    throw new Error('SELECT password FROM users\n    at ProbeController.boom');
  }
}

describe('统一错误响应', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = module.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('校验失败带 code、requestId，并把字段错误放进 details', async () => {
    const response = await request(app.getHttpServer())
      .get('/probe/validation')
      .set('X-Request-Id', 'req-validation');

    expect(response.status).toBe(400);
    expect(response.headers['x-request-id']).toBe('req-validation');
    expect(response.body).toEqual({
      code: 'COMMON_VALIDATION_ERROR',
      message: '邮箱不能为空；邮箱格式不正确',
      details: ['邮箱不能为空', '邮箱格式不正确'],
      requestId: 'req-validation',
    });
  });

  it('登录失败使用认证错误码，并保留原文', async () => {
    const response = await request(app.getHttpServer()).get('/probe/credentials');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(response.body.message).toBe('邮箱/手机号或密码错误');
    expect(response.body.requestId).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
  });

  it('能力拒绝使用 CAPABILITY_DENIED，不把代号当提示文案', async () => {
    const response = await request(app.getHttpServer()).get('/probe/capability');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CAPABILITY_DENIED');
    expect(response.body.message).toBe('当前账号的这项功能已暂停');
  });

  it('唯一键冲突返回 409，响应里没有 SQL', async () => {
    const response = await request(app.getHttpServer()).get('/probe/conflict');

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('COMMON_CONFLICT');
    expect(response.body.message).toBe('数据已存在，请勿重复提交');
    expect(response.body.requestId).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toContain('SELECT');
    expect(JSON.stringify(response.body)).not.toContain('Unique constraint failed');
  });

  it('Prisma 找不到记录时返回 404', async () => {
    const response = await request(app.getHttpServer()).get('/probe/missing');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: 'COMMON_RESOURCE_NOT_FOUND',
      message: '资源不存在',
    });
  });

  it('生产环境的 500 不返回堆栈或 SQL', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const response = await request(app.getHttpServer()).get('/probe/boom');
      expect(response.status).toBe(500);
      expect(response.body.code).toBe('COMMON_INTERNAL_ERROR');
      expect(response.body.message).toBe('服务器内部错误');
      expect(JSON.stringify(response.body)).not.toContain('SELECT');
      expect(JSON.stringify(response.body)).not.toContain('ProbeController');
      expect(response.body.requestId).toBeTruthy();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
