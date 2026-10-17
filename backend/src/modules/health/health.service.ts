import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';

export type CheckState = 'ok' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'down';
  checks: {
    database: CheckState;
    redis: CheckState;
    disk: CheckState;
  };
}

const CHECK_TIMEOUT_MS = 1000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  live() {
    return { status: 'ok' as const };
  }

  async readiness(): Promise<ReadinessReport> {
    const [database, redis, disk] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkDisk(),
    ]);
    const checks = { database, redis, disk };
    const status = Object.values(checks).every((item) => item === 'ok') ? 'ok' : 'down';
    return { status, checks };
  }

  private async checkDatabase(): Promise<CheckState> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`);
      return 'ok';
    } catch {
      this.logger.warn('数据库健康检查失败');
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckState> {
    if (!this.redis.ready || !this.redis.client) return 'down';
    try {
      const pong = await withTimeout(this.redis.client.ping());
      return pong === 'PONG' ? 'ok' : 'down';
    } catch {
      this.logger.warn('Redis 健康检查失败');
      return 'down';
    }
  }

  private async checkDisk(): Promise<CheckState> {
    const configured = this.configService.get<string>('UPLOAD_DIR');
    const dir = typeof configured === 'string' && configured.trim() ? configured.trim() : join(process.cwd(), 'uploads');
    try {
      await access(dir, constants.W_OK);
      return 'ok';
    } catch {
      this.logger.warn('上传目录不可写');
      return 'down';
    }
  }
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health check timeout')), CHECK_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
