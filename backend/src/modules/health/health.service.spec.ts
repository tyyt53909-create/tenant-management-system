import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('健康检查', () => {
  let app: INestApplication;
  const dirs: string[] = [];
  const previousUpload = process.env.UPLOAD_DIR;

  afterEach(async () => {
    if (previousUpload === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUpload;
    await app?.close();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(databaseFails: boolean, redisReady: boolean) {
    const uploadDir = await mkdtemp(join(tmpdir(), 'health-disk-'));
    dirs.push(uploadDir);
    process.env.UPLOAD_DIR = uploadDir;
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: databaseFails
              ? () => Promise.reject(new Error('connect ECONNREFUSED'))
              : () => Promise.resolve([{ ok: 1 }]),
          },
        },
        {
          provide: RedisService,
          useValue: {
            ready: redisReady,
            client: redisReady ? { ping: () => Promise.resolve('PONG') } : null,
          },
        },
        // UPLOAD_DIR 由 ConfigService 读取（其本身回退到 process.env，本档用 env 注入临时目录）
        ConfigService,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  }

  it('数据库停下后 /health/ready 返回 503，/health 仍返回 200', async () => {
    await boot(true, true);

    const live = await request(app.getHttpServer()).get('/health');
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ status: 'ok' });

    const liveness = await request(app.getHttpServer()).get('/health/live');
    expect(liveness.status).toBe(200);
    expect(liveness.body).toEqual({ status: 'ok' });

    const ready = await request(app.getHttpServer()).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({
      status: 'down',
      checks: { database: 'down', redis: 'ok', disk: 'ok' },
    });
  });

  it('数据库、Redis 和上传目录都可用时返回 200', async () => {
    await boot(false, true);
    const ready = await request(app.getHttpServer()).get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe('ok');
  });

  it('Redis 不可用时 ready 返回 503', async () => {
    await boot(false, false);
    const ready = await request(app.getHttpServer()).get('/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.checks.redis).toBe('down');
    expect(ready.body.checks.database).toBe('ok');
  });
});
